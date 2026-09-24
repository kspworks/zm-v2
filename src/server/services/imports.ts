import { gunzipSync } from "node:zlib";

import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { MAX_IMPORT_BYTES } from "~/lib/import-limits";
import type { DbOrTx } from "~/server/db";
import {
  accountMembers,
  accounts,
  categories,
  categoryMembers,
  currencies,
  imports,
  plannedTransactions,
  transactions,
} from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now, parseLocalDateTime } from "~/server/lib/clock";
import {
  accountTypeFromName,
  type ImportRowError,
  parseCsv,
  validateRows,
} from "~/server/lib/csv-import";
import { appError, notFound } from "~/server/lib/errors";
import {
  getOrCreateDebtAccount,
  insertAccount,
} from "~/server/services/accounts";
import { insertCategory } from "~/server/services/categories";
import { resolveCounterparty } from "~/server/services/counterparties";
import { insertLegs, type Leg } from "~/server/services/transactions";

/** Carries the row-level errors to the client (see the tRPC error formatter) */
export class ImportRowsError extends Error {
  constructor(readonly rows: ImportRowError[]) {
    super("import_invalid");
  }
}

const HOUR = 60 * 60 * 1000;

/**
 * The client sends the file gzipped. `maxOutputLength` caps the decoded size
 * during inflation, so an oversized file — or a zip bomb — never materialises.
 */
const decode = (base64: string): string => {
  try {
    return gunzipSync(Buffer.from(base64, "base64"), {
      maxOutputLength: MAX_IMPORT_BYTES,
    }).toString("utf8");
  } catch (error) {
    throw appError("BAD_REQUEST", "import_invalid", error);
  }
};

export type ImportSummary = {
  importId: string;
  transactions: number;
  accounts: number;
  categories: number;
};

/**
 * Imports a ZenMoney CSV export. The whole file is validated first; then the
 * import row, categories, accounts, transactions and counterparties are
 * written in ONE transaction, so a failure leaves nothing behind. One
 * successful import per user per hour.
 */
export const uploadImport = async (
  db: DbOrTx,
  userId: string,
  input: { fileName: string; content: string },
): Promise<ImportSummary> => {
  const text = decode(input.content);
  const codes = await db.select().from(currencies);
  const currencyByCode = new Map(codes.map((c) => [c.code, c.id]));

  let raw: ReturnType<typeof parseCsv>;

  try {
    raw = parseCsv(text);
  } catch (error) {
    throw appError("BAD_REQUEST", "import_invalid", error);
  }

  const { rows, errors } = validateRows(raw, [...currencyByCode.keys()]);

  if (errors.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "import_invalid",
      cause: new ImportRowsError(errors),
    });
  }

  if (rows.length === 0) {
    throw appError("BAD_REQUEST", "import_invalid");
  }

  return db.transaction(async (tx) => {
    // serialise a user's uploads, so the hourly count can't be raced
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`import:${userId}`}))`,
    );

    const [recent] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(imports)
      .where(
        and(
          eq(imports.userId, userId),
          gte(imports.createdAt, new Date(now().getTime() - HOUR)),
        ),
      );

    if ((recent?.count ?? 0) >= 1) {
      throw appError("TOO_MANY_REQUESTS", "upload_count_exceeded");
    }

    const [created] = await tx
      .insert(imports)
      // stamped by the app clock, which the hourly window is measured with
      .values({
        userId,
        fileName: input.fileName.slice(0, 255),
        createdAt: now(),
      })
      .returning({ id: imports.id });

    if (!created) {
      throw new Error("Import insert returned no row");
    }

    const importId = created.id;

    // --- categories: parents by name, children by name within each parent
    const flags = new Map<string, { isExpense: boolean; isIncome: boolean }>();

    for (const row of rows) {
      if (!row.categoryName) {
        continue;
      }

      const current = flags.get(row.categoryName) ?? {
        isExpense: false,
        isIncome: false,
      };

      flags.set(row.categoryName, {
        isExpense: current.isExpense || row.outcome !== null,
        isIncome: current.isIncome || row.income !== null,
      });
    }

    const split = (full: string) => {
      const [parent = full, ...rest] = full.split(" / ");

      return { parent: parent.trim(), child: rest.join(" / ").trim() || null };
    };

    const tree = new Map<string, Set<string>>();

    for (const full of flags.keys()) {
      const { parent, child } = split(full);
      const children = tree.get(parent) ?? new Set<string>();

      if (child) {
        children.add(child);
      }

      tree.set(parent, children);
    }

    const collator = new Intl.Collator("uk");
    const categoryIds = new Map<string, string>();

    for (const parent of [...tree.keys()].sort(collator.compare)) {
      const children = [...(tree.get(parent) ?? [])].sort(collator.compare);
      // a parent only used through its children takes their flags
      const own = flags.get(parent);
      const union = children.reduce(
        (acc, child) => {
          const f = flags.get(`${parent} / ${child}`);

          return {
            isExpense: acc.isExpense || !!f?.isExpense,
            isIncome: acc.isIncome || !!f?.isIncome,
          };
        },
        { isExpense: false, isIncome: false },
      );
      const parentFlags = own ?? union;

      const parentRow = await insertCategory(tx, {
        userId,
        values: {
          name: parent,
          parentId: null,
          isExpense: parentFlags.isExpense || !parentFlags.isIncome,
          isIncome: parentFlags.isIncome,
          importId,
        },
      });
      categoryIds.set(parent, parentRow.id);

      for (const child of children) {
        const childFlags = flags.get(`${parent} / ${child}`) ?? parentFlags;
        const childRow = await insertCategory(tx, {
          userId,
          values: {
            name: child,
            parentId: parentRow.id,
            isExpense: childFlags.isExpense || !childFlags.isIncome,
            isIncome: childFlags.isIncome,
            importId,
          },
        });
        categoryIds.set(`${parent} / ${child}`, childRow.id);
      }
    }

    // --- accounts: one per distinct (name, currency)
    const accountIds = new Map<string, string>();
    const accountTypes = new Map<string, "debt" | "cash" | "card">();
    let createdAccounts = 0;

    const accountKey = (name: string, code: string) => `${name}\u0000${code}`;

    for (const row of rows) {
      for (const [name, code] of [
        [row.outcomeAccountName, row.outcomeCurrency],
        [row.incomeAccountName, row.incomeCurrency],
      ] as const) {
        if (!name || !code || accountIds.has(accountKey(name, code))) {
          continue;
        }

        const currencyId = currencyByCode.get(code) ?? "";
        const type = accountTypeFromName(name);
        let id: string;

        if (type === "debt") {
          // debts always live on the user's single debt account per currency
          id = await getOrCreateDebtAccount(tx, userId, currencyId);
        } else {
          const [existing] = await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(
              and(
                eq(accounts.createdBy, userId),
                eq(accounts.name, name),
                eq(accounts.currencyId, currencyId),
                isNull(accounts.deletedAt),
              ),
            )
            // an undo of the import that created it can't delete it under us
            .for("share");

          if (existing) {
            id = existing.id;
          } else {
            const account = await insertAccount(tx, {
              userId,
              values: {
                name,
                type,
                currencyId,
                initialBalance: 0,
                isActive: true,
                importId,
              },
            });
            id = account.id;
            createdAccounts += 1;
          }
        }

        accountIds.set(accountKey(name, code), id);
        accountTypes.set(id, type);
      }
    }

    // --- transactions
    const counterpartyIds = new Map<string, string>();

    for (const row of rows) {
      const counterpartyId = row.payee
        ? (counterpartyIds.get(row.payee.toLocaleLowerCase()) ??
          (await resolveCounterparty(tx, userId, row.payee)))
        : null;

      if (row.payee && counterpartyId) {
        counterpartyIds.set(row.payee.toLocaleLowerCase(), counterpartyId);
      }

      const outcomeAccount =
        row.outcomeAccountName && row.outcomeCurrency
          ? accountIds.get(
              accountKey(row.outcomeAccountName, row.outcomeCurrency),
            )
          : undefined;
      const incomeAccount =
        row.incomeAccountName && row.incomeCurrency
          ? accountIds.get(
              accountKey(row.incomeAccountName, row.incomeCurrency),
            )
          : undefined;
      const categoryId = row.categoryName
        ? (categoryIds.get(row.categoryName) ?? null)
        : null;
      const base = {
        date: row.date,
        comment: row.comment,
        counterpartyId,
      };

      let legs: Leg[];

      if (row.outcome && row.income && outcomeAccount && incomeAccount) {
        const isDebt =
          accountTypes.get(outcomeAccount) === "debt" ||
          accountTypes.get(incomeAccount) === "debt";
        const kind = isDebt ? ("debt" as const) : ("transfer" as const);

        legs = [
          {
            ...base,
            kind,
            amount: -row.outcome,
            accountId: outcomeAccount,
            categoryId: null,
          },
          {
            ...base,
            kind,
            amount: row.income,
            accountId: incomeAccount,
            categoryId: null,
          },
        ];
      } else if (row.outcome && outcomeAccount) {
        legs = [
          {
            ...base,
            kind: "expense",
            amount: -row.outcome,
            accountId: outcomeAccount,
            categoryId,
          },
        ];
      } else if (row.income && incomeAccount) {
        legs = [
          {
            ...base,
            kind: "income",
            amount: row.income,
            accountId: incomeAccount,
            categoryId,
          },
        ];
      } else {
        throw appError("BAD_REQUEST", "import_empty_row");
      }

      await insertLegs(tx, userId, legs, {
        importId,
        createdAt: parseLocalDateTime(row.createdDate),
      });
    }

    await audit(tx, {
      entityType: "import",
      entityId: importId,
      action: "create",
      userId,
      payload: { fileName: input.fileName, rows: rows.length },
    });

    return {
      importId,
      transactions: rows.length,
      accounts: createdAccounts,
      categories: categoryIds.size,
    };
  });
};

const countBy = (
  table: typeof accounts | typeof categories | typeof transactions,
) =>
  sql<number>`(
    SELECT count(*) FROM ${table} x
    WHERE x.import_id = "imports"."id" AND x.deleted_at IS NULL
  )`.mapWith(Number);

/** The user's imports, newest first, with what each one created */
export const listImports = (db: DbOrTx, userId: string) =>
  db
    .select({
      id: imports.id,
      fileName: imports.fileName,
      createdAt: imports.createdAt,
      transactions: sql<number>`(
        SELECT count(*) FROM ${transactions} x
        WHERE x.import_id = "imports"."id" AND x.deleted_at IS NULL
          AND (x.batch_id IS NULL OR x.amount < 0)
      )`.mapWith(Number),
      accounts: countBy(accounts),
      categories: countBy(categories),
    })
    .from(imports)
    .where(and(eq(imports.userId, userId), isNull(imports.deletedAt)))
    .orderBy(desc(imports.createdAt), asc(imports.id));

/**
 * Any live transaction or schedule on the accounts that didn't come from this
 * import: added by hand (planned occurrences included) or by a later import
 * that reused the account by name.
 */
const importAccountsInUse = async (
  tx: DbOrTx,
  importId: string,
  accountIds: string[],
): Promise<boolean> => {
  const [transaction] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        inArray(transactions.accountId, accountIds),
        isNull(transactions.deletedAt),
        or(isNull(transactions.importId), ne(transactions.importId, importId)),
      ),
    )
    .limit(1);

  if (transaction) {
    return true;
  }

  const [schedule] = await tx
    .select({ id: plannedTransactions.id })
    .from(plannedTransactions)
    .where(
      and(
        inArray(plannedTransactions.accountId, accountIds),
        isNull(plannedTransactions.deletedAt),
      ),
    )
    .limit(1);

  return schedule !== undefined;
};

/**
 * Undo: soft-deletes the import and every account, category and transaction
 * it created, in one transaction. Refused while the import's accounts hold
 * anything else, which would otherwise stay live on a deleted account.
 */
export const undoImport = (db: DbOrTx, userId: string, importId: string) =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(imports)
      .where(
        and(
          eq(imports.id, importId),
          eq(imports.userId, userId),
          isNull(imports.deletedAt),
        ),
      )
      .for("update");

    if (!row) {
      throw notFound();
    }

    const at = new Date();
    const live = <T extends { importId: unknown; deletedAt: unknown }>(t: T) =>
      and(
        eq(t.importId as typeof imports.id, importId),
        isNull(t.deletedAt as typeof imports.deletedAt),
      );

    // locked in id order like any account change, so writes into these
    // accounts either finish first and are seen below, or find them gone
    const importAccounts = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(live(accounts))
      .orderBy(accounts.id)
      .for("update");

    if (
      importAccounts.length > 0 &&
      (await importAccountsInUse(
        tx,
        importId,
        importAccounts.map((a) => a.id),
      ))
    ) {
      throw appError("BAD_REQUEST", "import_accounts_in_use");
    }

    const removedTransactions = await tx
      .update(transactions)
      .set({ deletedAt: at })
      .where(live(transactions))
      .returning({ id: transactions.id });

    const removedAccounts = await tx
      .update(accounts)
      .set({ deletedAt: at })
      .where(live(accounts))
      .returning({ id: accounts.id });

    if (removedAccounts.length) {
      await tx
        .update(accountMembers)
        .set({ deletedAt: at })
        .where(
          and(
            inArray(
              accountMembers.accountId,
              removedAccounts.map((a) => a.id),
            ),
            isNull(accountMembers.deletedAt),
          ),
        );
    }

    const removedCategories = await tx
      .update(categories)
      .set({ deletedAt: at })
      .where(live(categories))
      .returning({ id: categories.id });

    if (removedCategories.length) {
      await tx
        .update(categoryMembers)
        .set({ deletedAt: at })
        .where(
          and(
            inArray(
              categoryMembers.categoryId,
              removedCategories.map((c) => c.id),
            ),
            isNull(categoryMembers.deletedAt),
          ),
        );
    }

    await tx
      .update(imports)
      .set({ deletedAt: at })
      .where(eq(imports.id, importId));

    const ids = {
      transaction: removedTransactions.map((r) => r.id),
      account: removedAccounts.map((r) => r.id),
      category: removedCategories.map((r) => r.id),
    };

    for (const entityType of ["transaction", "account", "category"] as const) {
      await audit(tx, {
        entityType,
        entityId: ids[entityType],
        action: "delete",
        userId,
        payload: { undoImport: importId },
      });
    }

    await audit(tx, {
      entityType: "import",
      entityId: importId,
      action: "delete",
      userId,
      payload: {},
    });

    return {
      transactions: removedTransactions.length,
      accounts: removedAccounts.length,
      categories: removedCategories.length,
    };
  });
