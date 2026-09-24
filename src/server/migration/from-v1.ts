import { getISODay, parseISO } from "date-fns";
import { count, sql } from "drizzle-orm";
import type postgres from "postgres";

import { encryptValue, generateBackupCodes } from "~/server/auth/two-factor";
import type { Db } from "~/server/db";
import {
  accountMembers,
  accounts,
  authAccounts,
  categories,
  categoryMembers,
  counterparties,
  currencies,
  historyLogs,
  imports,
  invites,
  plannedTransactions,
  transactions,
  twoFactors,
  users,
} from "~/server/db/schema";
import { newId } from "~/server/lib/ids";
import { LEGACY_PREFIX } from "~/server/lib/totp";

/*
 * v1 → v2. Reads the old database with raw SQL, writes the new one in ONE
 * transaction, and refuses a target that already has users. v1 had no
 * foreign keys and fewer constraints, so rows that would break the new ones
 * are repaired (and reported) rather than failing the whole migration.
 */

type Log = (line: string) => void;

type Row = Record<string, unknown>;

const CHUNK = 1000;

const str = (value: unknown) =>
  value === null || value === undefined ? null : String(value);
const date = (value: unknown) => (value ? new Date(value as string) : null);

export type V1Report = {
  counts: { table: string; old: number; new: number }[];
  balanceMismatches: {
    accountId: string;
    name: string;
    old: number;
    new: number;
  }[];
  kinds: Record<string, number>;
  mergedPayees: { ownerId: string; kept: string; variants: string[] }[];
  repairs: string[];
};

const insertChunks = async <T>(
  items: T[],
  insert: (chunk: T[]) => Promise<unknown>,
) => {
  for (let index = 0; index < items.length; index += CHUNK) {
    await insert(items.slice(index, index + CHUNK));
  }
};

export const migrateFromV1 = async (
  old: postgres.Sql,
  target: Db,
  log: Log = () => undefined,
): Promise<V1Report> => {
  const [existing] = await target.select({ value: count() }).from(users);

  if ((existing?.value ?? 0) > 0) {
    throw new Error(
      "The target database already has users; refusing to migrate",
    );
  }

  const repairs: string[] = [];
  const read = <T extends Row>(query: string) => old.unsafe<T[]>(query);

  const oldUsers = await read(`SELECT *, created_at FROM users`);
  const oldCurrencies = await read(`SELECT id, code FROM currencies`);
  const oldAccounts = await read(`SELECT * FROM accounts`);
  const oldAccountUsers = await read(`SELECT * FROM accounts_users`);
  const oldCategories = await read(`SELECT * FROM categories`);
  const oldCategoryUsers = await read(`SELECT * FROM categories_users`);
  const oldTransactions = await read(
    `SELECT *, date::text AS date_text FROM transactions`,
  );
  const oldPlanned = await read(
    `SELECT *, start_date::text AS start_text, end_date::text AS end_text FROM planned_transactions`,
  );
  const oldImports = await read(`SELECT * FROM imports`);
  const oldHistory = await read(`SELECT * FROM history_logs`);
  const oldInvites = await read(`SELECT * FROM invites`);

  // --- currencies: the seeded ones must match by id and code
  const newCurrencies = await target.select().from(currencies);
  const currencyIds = new Set(newCurrencies.map((c) => c.id));

  for (const currency of oldCurrencies) {
    const match = newCurrencies.find((c) => c.id === currency.id);

    if (!match || match.code !== currency.code) {
      throw new Error(
        `Currency ${currency.code} (${currency.id}) has no match in the new database`,
      );
    }
  }

  const report = await target.transaction(async (tx) => {
    // --- users + credentials + 2FA
    const userIds = new Set(oldUsers.map((u) => String(u.id)));

    for (const user of oldUsers) {
      const id = String(user.id);
      const email = String(user.email).trim().toLowerCase();
      const deleted = date(user.deleted_at);

      await tx.insert(users).values({
        id,
        name: str(user.name) ?? email,
        // a deleted user's address moves aside so it can be invited again
        email: deleted ? `${id}@deleted.invalid` : email,
        deletedEmail: deleted ? email : null,
        emailVerified: user.email_verified !== null,
        image: str(user.image),
        role: user.type === "admin" ? "admin" : "user",
        locale: user.locale === "en" ? "en" : "uk",
        twoFactorEnabled: !!user.otp_secret,
        createdAt: date(user.created_at) ?? new Date(),
        updatedAt: date(user.updated_at) ?? new Date(),
        deletedAt: deleted,
      });

      if (user.password) {
        // bcrypt: accepted by the password verifier and rehashed on sign-in
        await tx.insert(authAccounts).values({
          accountId: id,
          providerId: "credential",
          userId: id,
          password: String(user.password),
        });
      }

      if (user.otp_secret) {
        await tx.insert(twoFactors).values({
          userId: id,
          secret: await encryptValue(`${LEGACY_PREFIX}${user.otp_secret}`),
          backupCodes: await encryptValue(
            JSON.stringify(generateBackupCodes()),
          ),
          verified: true,
        });
      }
    }

    log(`users: ${oldUsers.length}`);

    // --- imports
    await insertChunks(
      oldImports.filter((i) => userIds.has(String(i.user_id))),
      (chunk) =>
        tx.insert(imports).values(
          chunk.map((i) => ({
            id: String(i.id),
            userId: String(i.user_id),
            fileName: String(i.file_name),
            createdAt: date(i.created_at) ?? new Date(),
            updatedAt: date(i.updated_at) ?? new Date(),
            deletedAt: date(i.deleted_at),
          })),
        ),
    );
    const importIds = new Set(oldImports.map((i) => String(i.id)));
    const importRef = (value: unknown) =>
      value && importIds.has(String(value)) ? String(value) : null;

    // --- accounts (current_balance/usage are derived now)
    const accountRows = oldAccounts.filter((a) => {
      const ok =
        userIds.has(String(a.created_by)) &&
        currencyIds.has(String(a.currency_id));

      if (!ok) {
        repairs.push(`account ${a.id}: unknown owner or currency, skipped`);
      }

      return ok;
    });
    const accountIds = new Set(accountRows.map((a) => String(a.id)));
    const accountType = new Map(
      accountRows.map((a) => [String(a.id), String(a.type)]),
    );
    const taken = new Set<string>();

    await insertChunks(accountRows, (chunk) =>
      tx.insert(accounts).values(
        chunk.map((a) => {
          let name = String(a.name).trim();
          const key = (n: string) => `${n}|${a.currency_id}|${a.created_by}`;

          if (!a.deleted_at) {
            // live names are unique per (name, currency, owner) now
            const base = name;

            for (let n = 2; taken.has(key(name)); n++) {
              name = `${base} (${n})`;
            }

            if (name !== base) {
              repairs.push(
                `account ${a.id}: renamed "${base}" to "${name}" (duplicate)`,
              );
            }

            taken.add(key(name));
          }

          return {
            id: String(a.id),
            name,
            type: a.type as (typeof accounts.$inferInsert)["type"],
            currencyId: String(a.currency_id),
            initialBalance: Number(a.initial_balance),
            isActive: Boolean(a.is_active),
            importId: importRef(a.import_id),
            createdBy: String(a.created_by),
            createdAt: date(a.created_at) ?? new Date(),
            updatedAt: date(a.updated_at) ?? new Date(),
            deletedAt: date(a.deleted_at),
          };
        }),
      ),
    );

    await insertChunks(
      oldAccountUsers.filter(
        (m) =>
          accountIds.has(String(m.account_id)) &&
          userIds.has(String(m.user_id)),
      ),
      (chunk) =>
        tx.insert(accountMembers).values(
          chunk.map((m) => ({
            id: newId(),
            accountId: String(m.account_id),
            userId: String(m.user_id),
            canRead: Boolean(m.can_read),
            canWrite: Boolean(m.can_write),
            createdAt: date(m.created_at) ?? new Date(),
            updatedAt: date(m.updated_at) ?? new Date(),
            deletedAt: date(m.deleted_at),
          })),
        ),
    );

    // --- categories: parents first; a child whose parent is missing
    // becomes top-level
    const categoryRows = oldCategories.filter((c) =>
      userIds.has(String(c.created_by)),
    );
    const categoryIds = new Set(categoryRows.map((c) => String(c.id)));
    const ordered = [
      ...categoryRows.filter(
        (c) => !c.parent_id || !categoryIds.has(String(c.parent_id)),
      ),
      ...categoryRows.filter(
        (c) => c.parent_id && categoryIds.has(String(c.parent_id)),
      ),
    ];

    await insertChunks(ordered, (chunk) =>
      tx.insert(categories).values(
        chunk.map((c) => {
          const parentId =
            c.parent_id && categoryIds.has(String(c.parent_id))
              ? String(c.parent_id)
              : null;

          if (c.parent_id && !parentId) {
            repairs.push(`category ${c.id}: missing parent, made top-level`);
          }

          const isIncome = Boolean(c.is_income);
          const isExpense = Boolean(c.is_expense) || !isIncome;

          if (!c.is_income && !c.is_expense) {
            repairs.push(
              `category ${c.id}: had neither flag, marked as expense`,
            );
          }

          return {
            id: String(c.id),
            parentId,
            name: String(c.name).trim(),
            isIncome,
            isExpense,
            importId: importRef(c.import_id),
            createdBy: String(c.created_by),
            createdAt: date(c.created_at) ?? new Date(),
            updatedAt: date(c.updated_at) ?? new Date(),
            deletedAt: date(c.deleted_at),
          };
        }),
      ),
    );

    await insertChunks(
      oldCategoryUsers.filter(
        (m) =>
          categoryIds.has(String(m.category_id)) &&
          userIds.has(String(m.user_id)),
      ),
      (chunk) =>
        tx.insert(categoryMembers).values(
          chunk.map((m) => ({
            id: newId(),
            categoryId: String(m.category_id),
            userId: String(m.user_id),
            canRead: Boolean(m.can_read),
            canWrite: Boolean(m.can_write),
            createdAt: date(m.created_at) ?? new Date(),
            updatedAt: date(m.updated_at) ?? new Date(),
            deletedAt: date(m.deleted_at),
          })),
        ),
    );

    // --- payee → counterparty, per owner, case-insensitively, keeping the
    // most-used spelling
    const spellings = new Map<string, Map<string, Map<string, number>>>();

    for (const row of [...oldTransactions, ...oldPlanned]) {
      const payee = str(row.payee)?.trim().replace(/\s+/g, " ");
      const owner = String(row.created_by);

      if (!payee || !userIds.has(owner)) {
        continue;
      }

      const byKey = spellings.get(owner) ?? new Map();
      const variants =
        byKey.get(payee.toLocaleLowerCase()) ?? new Map<string, number>();
      variants.set(payee, (variants.get(payee) ?? 0) + 1);
      byKey.set(payee.toLocaleLowerCase(), variants);
      spellings.set(owner, byKey);
    }

    const counterpartyId = new Map<string, string>();
    const mergedPayees: V1Report["mergedPayees"] = [];

    for (const [ownerId, byKey] of spellings) {
      for (const [key, variants] of byKey) {
        const sorted = [...variants.entries()].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        );
        const kept = sorted[0]?.[0] ?? key;
        const id = newId();

        await tx
          .insert(counterparties)
          .values({ id, ownerId, name: kept.slice(0, 255) });
        counterpartyId.set(`${ownerId}|${key}`, id);

        if (sorted.length > 1) {
          mergedPayees.push({
            ownerId,
            kept,
            variants: sorted.map(([name]) => name),
          });
        }
      }
    }

    const counterpartyOf = (row: Row) => {
      const payee = str(row.payee)?.trim().replace(/\s+/g, " ");

      return payee
        ? (counterpartyId.get(
            `${row.created_by}|${payee.toLocaleLowerCase()}`,
          ) ?? null)
        : null;
    };

    // --- kind: single rows by sign; pairs are debt if either leg is on a
    // debt account, else transfer
    const kindOf = (rows: Row[]) => {
      const byBatch = new Map<string, string[]>();

      for (const row of rows) {
        if (row.batch_id) {
          const list = byBatch.get(String(row.batch_id)) ?? [];
          list.push(String(row.account_id));
          byBatch.set(String(row.batch_id), list);
        }
      }

      return (row: Row): (typeof transactions.$inferInsert)["kind"] => {
        if (!row.batch_id) {
          return Number(row.amount) < 0 ? "expense" : "income";
        }

        const legs = byBatch.get(String(row.batch_id)) ?? [];

        return legs.some((id) => accountType.get(id) === "debt")
          ? "debt"
          : "transfer";
      };
    };

    // --- schedules
    const plannedKind = kindOf(oldPlanned);
    const plannedRows = oldPlanned.filter((p) => {
      const ok =
        accountIds.has(String(p.account_id)) &&
        userIds.has(String(p.created_by)) &&
        Number(p.amount) !== 0;

      if (!ok) {
        repairs.push(
          `schedule ${p.id}: unknown account/owner or zero amount, skipped`,
        );
      }

      return ok;
    });
    const plannedIds = new Set(plannedRows.map((p) => String(p.id)));

    await insertChunks(plannedRows, (chunk) =>
      tx.insert(plannedTransactions).values(
        chunk.map((p) => {
          const startDate = String(p.start_text);
          let endDate = str(p.end_text);
          const repeatType = String(
            p.repeat_type,
          ) as (typeof plannedTransactions.$inferInsert)["repeatType"];
          let weekdays = ((p.repeat_weekdays as number[] | null) ?? []).filter(
            (d) => d >= 1 && d <= 7,
          );

          if (repeatType !== "weekly") {
            weekdays = [];
          } else if (weekdays.length === 0) {
            weekdays = [getISODay(parseISO(startDate))];
            repairs.push(
              `schedule ${p.id}: weekly without weekdays, used the start's`,
            );
          }

          if (endDate && endDate < startDate) {
            repairs.push(
              `schedule ${p.id}: end before start, end set to start`,
            );
            endDate = startDate;
          }

          return {
            id: String(p.id),
            batchId: str(p.batch_id),
            kind: plannedKind(p),
            startDate,
            endDate,
            repeatType,
            repeatInterval: Math.min(
              31,
              Math.max(1, Number(p.repeat_interval) || 1),
            ),
            repeatWeekdays: weekdays,
            amount: Number(p.amount),
            accountId: String(p.account_id),
            categoryId:
              p.category_id && categoryIds.has(String(p.category_id))
                ? String(p.category_id)
                : null,
            comment: str(p.comment)?.trim() || null,
            counterpartyId: counterpartyOf(p),
            createdBy: String(p.created_by),
            createdAt: date(p.created_at) ?? new Date(),
            updatedAt: date(p.updated_at) ?? new Date(),
            deletedAt: date(p.deleted_at),
          };
        }),
      ),
    );

    // --- transactions
    const transactionKind = kindOf(oldTransactions);
    const transactionRows = oldTransactions.filter((t) => {
      const ok =
        accountIds.has(String(t.account_id)) &&
        userIds.has(String(t.created_by)) &&
        Number(t.amount) !== 0;

      if (!ok) {
        repairs.push(
          `transaction ${t.id}: unknown account/owner or zero amount, skipped`,
        );
      }

      return ok;
    });

    await insertChunks(transactionRows, (chunk) =>
      tx.insert(transactions).values(
        chunk.map((t) => ({
          id: String(t.id),
          kind: transactionKind(t),
          batchId: str(t.batch_id),
          date: String(t.date_text),
          amount: Number(t.amount),
          accountId: String(t.account_id),
          categoryId:
            t.category_id && categoryIds.has(String(t.category_id))
              ? String(t.category_id)
              : null,
          comment: str(t.comment)?.trim() || null,
          counterpartyId: counterpartyOf(t),
          plannedTransactionId:
            t.planned_transaction_id &&
            plannedIds.has(String(t.planned_transaction_id))
              ? String(t.planned_transaction_id)
              : null,
          plannedHash: str(t.planned_hash),
          isPlanned: Boolean(t.is_planned),
          importId: importRef(t.import_id),
          createdBy: String(t.created_by),
          createdAt: date(t.created_at) ?? new Date(),
          updatedAt: date(t.updated_at) ?? new Date(),
          deletedAt: date(t.deleted_at),
        })),
      ),
    );

    // --- history logs, as-is apart from v2's entity type names
    const entityTypes: Record<string, string> = {
      accounts: "account",
      categories: "category",
      planned_transactions: "schedule",
      transactions: "transaction",
    };

    await insertChunks(oldHistory, (chunk) =>
      tx.insert(historyLogs).values(
        chunk.map((h) => ({
          id: String(h.id),
          entityType:
            entityTypes[String(h.entity_type)] ?? String(h.entity_type),
          entityId: String(h.entity_id),
          action:
            h.entity_action as (typeof historyLogs.$inferInsert)["action"],
          userId: String(h.user_id),
          payload: (h.payload ?? {}) as object,
          createdAt: date(h.created_at) ?? new Date(),
        })),
      ),
    );

    // --- invites, claimed ones included, for history
    await insertChunks(oldInvites, (chunk) =>
      tx.insert(invites).values(
        chunk.map((i) => ({
          id: String(i.id),
          otpSecret: i.otp_secret ? `${LEGACY_PREFIX}${i.otp_secret}` : null,
          comment: str(i.comment) ?? "",
          userId:
            i.user_id && userIds.has(String(i.user_id))
              ? String(i.user_id)
              : null,
          createdBy: String(i.created_by),
          createdAt: date(i.created_at) ?? new Date(),
          updatedAt: date(i.updated_at) ?? new Date(),
        })),
      ),
    );

    // --- verification
    const newCount = async (table: string) => {
      const [row] = await tx.execute<{ n: string }>(
        sql.raw(`SELECT count(*) AS n FROM "${table}"`),
      );

      return Number(row?.n ?? 0);
    };
    const pairs: [string, string, number][] = [
      ["users", "users", oldUsers.length],
      ["accounts", "accounts", oldAccounts.length],
      ["accounts_users", "account_members", oldAccountUsers.length],
      ["categories", "categories", oldCategories.length],
      ["categories_users", "category_members", oldCategoryUsers.length],
      ["transactions", "transactions", oldTransactions.length],
      ["planned_transactions", "planned_transactions", oldPlanned.length],
      ["imports", "imports", oldImports.length],
      ["history_logs", "history_logs", oldHistory.length],
      ["invites", "invites", oldInvites.length],
    ];
    const counts = [];

    for (const [oldTable, newTable, oldCount] of pairs) {
      counts.push({
        table: `${oldTable} → ${newTable}`,
        old: oldCount,
        new: await newCount(newTable),
      });
    }

    const derived = await tx.execute<{ id: string; balance: string }>(sql`
      SELECT a.id, a.initial_balance + coalesce((
        SELECT sum(t.amount) FROM transactions t
        WHERE t.account_id = a.id AND t.deleted_at IS NULL AND NOT t.is_planned
      ), 0) AS balance
      FROM accounts a
    `);
    const derivedBalance = new Map(
      [...derived].map((r) => [r.id, Number(r.balance)]),
    );
    const balanceMismatches = accountRows
      .filter((a) => !a.deleted_at)
      .map((a) => ({
        accountId: String(a.id),
        name: String(a.name),
        old: Number(a.current_balance),
        new: derivedBalance.get(String(a.id)) ?? 0,
      }))
      .filter((a) => a.old !== a.new);

    const kinds: Record<string, number> = {};
    for (const row of await tx.execute<{ kind: string; n: string }>(
      sql`SELECT kind, count(*) AS n FROM transactions GROUP BY kind ORDER BY kind`,
    )) {
      kinds[row.kind] = Number(row.n);
    }

    return { counts, balanceMismatches, kinds, mergedPayees, repairs };
  });

  for (const { table, old: before, new: after } of report.counts) {
    log(`${table}: ${before} → ${after}`);
  }
  log(`transactions per kind: ${JSON.stringify(report.kinds)}`);
  for (const m of report.balanceMismatches) {
    log(
      `balance mismatch: ${m.name} (${m.accountId}) old ${m.old}, derived ${m.new}`,
    );
  }
  for (const m of report.mergedPayees) {
    log(
      `merged payees of ${m.ownerId}: ${m.variants.join(" | ")} → "${m.kept}"`,
    );
  }
  for (const line of report.repairs) {
    log(`repaired: ${line}`);
  }

  return report;
};
