import { and, asc, desc, eq, isNull, ne, or, type SQL, sql } from "drizzle-orm";

import type { AccountInput } from "~/lib/validators/accounts";
import type { DbOrTx } from "~/server/db";
import {
  accountMembers,
  accounts,
  currencies,
  plannedTransactions,
  transactions,
  users,
} from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { appError, forbidden, isUniqueViolation } from "~/server/lib/errors";
import { getServerTranslator } from "~/server/lib/i18n";
import { accountAccess } from "~/server/services/access";

export type AccountType = (typeof accounts.$inferSelect)["type"];

export type AccountInsert = {
  name: string;
  type: AccountType;
  currencyId: string;
  initialBalance: number;
  isActive: boolean;
  importId?: string | null;
};

/**
 * Inserts an account plus the creator's read+write member row (an account
 * without one would be invisible to everyone) and the audit row. Pass the
 * caller's transaction handle.
 */
export const insertAccount = async (
  tx: DbOrTx,
  { userId, values }: { userId: string; values: AccountInsert },
) => {
  const [account] = await tx
    .insert(accounts)
    .values({ ...values, name: values.name.trim(), createdBy: userId })
    .returning();

  if (!account) {
    throw new Error("Account insert returned no row");
  }

  await tx.insert(accountMembers).values({
    accountId: account.id,
    userId,
    canRead: true,
    canWrite: true,
  });

  await audit(tx, {
    entityType: "account",
    entityId: account.id,
    action: "create",
    userId,
    payload: values,
  });

  return account;
};

/**
 * Balance and usage are derived, never stored: initialBalance plus the sum
 * (and count) of the account's submitted, live transactions. A lateral
 * aggregate per account uses the partial balance index.
 */
export const accountStats = (db: DbOrTx) =>
  db
    .select({
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)`
        .mapWith(Number)
        .as("total"),
      usage: sql<number>`count(*)`.mapWith(Number).as("usage"),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accounts.id),
        isNull(transactions.deletedAt),
        eq(transactions.isPlanned, false),
      ),
    )
    .as("stats");

const memberCount = sql<number>`(
  SELECT count(*) FROM ${accountMembers} am
  WHERE am.account_id = ${accounts.id} AND am.deleted_at IS NULL
)`.mapWith(Number);

/** Readable accounts with derived balance, usage, rights and sharing info */
export const readableAccounts = (db: DbOrTx, userId: string, where?: SQL) => {
  const stats = accountStats(db);

  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currencyId: accounts.currencyId,
      currencyCode: currencies.code,
      currencySign: currencies.sign,
      initialBalance: accounts.initialBalance,
      isActive: accounts.isActive,
      importId: accounts.importId,
      createdBy: accounts.createdBy,
      ownerName: users.name,
      canWrite: accountMembers.canWrite,
      balance: sql<number>`${accounts.initialBalance} + ${stats.total}`.mapWith(
        Number,
      ),
      usage: stats.usage,
      memberCount,
    })
    .from(accounts)
    .innerJoin(
      accountMembers,
      and(
        eq(accountMembers.accountId, accounts.id),
        eq(accountMembers.userId, userId),
        isNull(accountMembers.deletedAt),
        eq(accountMembers.canRead, true),
      ),
    )
    .innerJoin(currencies, eq(currencies.id, accounts.currencyId))
    .innerJoin(users, eq(users.id, accounts.createdBy))
    .leftJoinLateral(stats, sql`true`)
    .where(and(isNull(accounts.deletedAt), where))
    .orderBy(desc(stats.usage), asc(accounts.name), asc(accounts.id));
};

export type AccountRow = Awaited<ReturnType<typeof readableAccounts>>[number];

const present = (userId: string) => (row: AccountRow) => ({
  ...row,
  isOwn: row.createdBy === userId,
  isShared: row.memberCount > 1,
});

/** The Accounts page and selects: every readable non-debt account */
export const listAccounts = async (db: DbOrTx, userId: string) =>
  (await readableAccounts(db, userId, ne(accounts.type, "debt"))).map(
    present(userId),
  );

export const listCurrencies = (db: DbOrTx) =>
  db.select().from(currencies).orderBy(asc(currencies.code));

const friendlyUniqueError = (error: unknown) => {
  if (isUniqueViolation(error, "accounts_name_currency_owner_live_uq")) {
    return appError("BAD_REQUEST", "account_name_not_unique", error);
  }

  return error;
};

export const createAccount = async (
  db: DbOrTx,
  userId: string,
  input: AccountInput,
) => {
  try {
    return await db.transaction((tx) =>
      insertAccount(tx, { userId, values: input }),
    );
  } catch (error) {
    throw friendlyUniqueError(error);
  }
};

/** Writable, not a debt account (those are system-managed) */
const requireEditableAccount = async (
  db: DbOrTx,
  userId: string,
  id: string,
) => {
  const access = (await accountAccess(db, userId, [id])).get(id);

  if (!access?.canWrite) {
    throw forbidden();
  }

  if (access.type === "debt") {
    throw forbidden("account_is_debt");
  }

  return access;
};

/** Any live transaction (submitted or planned) or live schedule */
const accountInUse = async (db: DbOrTx, id: string): Promise<boolean> => {
  const [row] = await db.execute<{ used: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM ${transactions}
      WHERE ${transactions.accountId} = ${id} AND ${transactions.deletedAt} IS NULL
    ) OR EXISTS (
      SELECT 1 FROM ${plannedTransactions}
      WHERE ${plannedTransactions.accountId} = ${id}
        AND ${plannedTransactions.deletedAt} IS NULL
    ) AS used
  `);

  return row?.used === true;
};

export const updateAccount = async (
  db: DbOrTx,
  userId: string,
  input: AccountInput & { id: string },
) => {
  try {
    return await db.transaction(async (tx) => {
      const current = await requireEditableAccount(tx, userId, input.id);

      if (
        current.currencyId !== input.currencyId &&
        (await accountInUse(tx, input.id))
      ) {
        throw appError("BAD_REQUEST", "account_currency_locked");
      }

      const { id, ...values } = input;
      const [updated] = await tx
        .update(accounts)
        .set({ ...values, name: values.name.trim() })
        .where(eq(accounts.id, id))
        .returning();

      await audit(tx, {
        entityType: "account",
        entityId: id,
        action: "update",
        userId,
        payload: input,
      });

      return updated;
    });
  } catch (error) {
    throw friendlyUniqueError(error);
  }
};

export const setAccountActive = (
  db: DbOrTx,
  userId: string,
  input: { id: string; isActive: boolean },
) =>
  db.transaction(async (tx) => {
    await requireEditableAccount(tx, userId, input.id);

    await tx
      .update(accounts)
      .set({ isActive: input.isActive })
      .where(eq(accounts.id, input.id));

    await audit(tx, {
      entityType: "account",
      entityId: input.id,
      action: "update",
      userId,
      payload: input,
    });
  });

/**
 * Soft delete, allowed only for an unused account: deleting one with
 * transactions would silently hide them, so the user is told to deactivate.
 */
export const deleteAccount = (db: DbOrTx, userId: string, id: string) =>
  db.transaction(async (tx) => {
    await requireEditableAccount(tx, userId, id);

    // lock the row so a concurrent insert can't slip in between the check
    // and the delete
    await tx.select().from(accounts).where(eq(accounts.id, id)).for("update");

    if (await accountInUse(tx, id)) {
      throw appError("BAD_REQUEST", "account_has_transactions");
    }

    const at = new Date();

    await tx.update(accounts).set({ deletedAt: at }).where(eq(accounts.id, id));
    await tx
      .update(accountMembers)
      .set({ deletedAt: at })
      .where(
        and(eq(accountMembers.accountId, id), isNull(accountMembers.deletedAt)),
      );

    await audit(tx, {
      entityType: "account",
      entityId: id,
      action: "delete",
      userId,
      payload: { id },
    });
  });

/**
 * The user's debt account for a currency, created on first use and named
 * "Debts" in the user's stored locale. An advisory lock serialises concurrent
 * first debts, and the partial unique index backs it up.
 */
export const getOrCreateDebtAccount = async (
  tx: DbOrTx,
  userId: string,
  currencyId: string,
): Promise<string> => {
  const find = async () => {
    const [row] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.createdBy, userId),
          eq(accounts.currencyId, currencyId),
          eq(accounts.type, "debt"),
          isNull(accounts.deletedAt),
        ),
      );

    return row?.id;
  };

  const existing = await find();

  if (existing) {
    return existing;
  }

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`debt-account:${userId}:${currencyId}`}))`,
  );

  const raced = await find();

  if (raced) {
    return raced;
  }

  const [user] = await tx
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, userId));
  const t = await getServerTranslator(user?.locale === "en" ? "en" : "uk");

  // the name only has to be unique per (name, currency, owner), and a user
  // may already own a regular account called "Debts": suffix until it fits
  const base = t("seed.debts");
  const taken = new Set(
    (
      await tx
        .select({ name: accounts.name })
        .from(accounts)
        .where(
          and(
            eq(accounts.createdBy, userId),
            eq(accounts.currencyId, currencyId),
            isNull(accounts.deletedAt),
            or(
              eq(accounts.name, base),
              sql`${accounts.name} LIKE ${`${base} (%)`}`,
            ),
          ),
        )
    ).map((row) => row.name),
  );
  let name = base;

  for (let n = 2; taken.has(name); n++) {
    name = `${base} (${n})`;
  }

  const account = await insertAccount(tx, {
    userId,
    values: {
      name,
      type: "debt",
      currencyId,
      initialBalance: 0,
      isActive: true,
    },
  });

  return account.id;
};
