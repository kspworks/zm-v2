import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  like,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";

import type { AccountInput } from "~/lib/validators/accounts";
import type { DbOrTx } from "~/server/db";
import { catchUniqueViolation, query, transaction } from "~/server/db/database";
import {
  accountMembers,
  accounts,
  currencies,
  plannedTransactions,
  transactions,
  users,
} from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now } from "~/server/lib/clock";
import { badRequest, forbidden } from "~/server/lib/errors";
import { serverTranslator } from "~/server/lib/i18n";
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
export const insertAccount = Effect.fn("accounts.insert")(function* ({
  userId,
  values,
}: {
  userId: string;
  values: AccountInsert;
}) {
  const [account] = yield* query((db) =>
    db
      .insert(accounts)
      .values({ ...values, name: values.name.trim(), createdBy: userId })
      .returning(),
  );

  if (!account) {
    return yield* Effect.die(new Error("Account insert returned no row"));
  }

  yield* query((db) =>
    db.insert(accountMembers).values({
      accountId: account.id,
      userId,
      canRead: true,
      canWrite: true,
    }),
  );

  yield* audit({
    entityType: "account",
    entityId: account.id,
    action: "create",
    userId,
    payload: values,
  });

  return account;
});

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
      usage: count().as("usage"),
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

const members = alias(accountMembers, "am");

/** Readable accounts with derived balance, usage, rights and sharing info */
export const readableAccounts = (db: DbOrTx, userId: string, where?: SQL) => {
  const stats = accountStats(db);

  return (
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        currencyId: accounts.currencyId,
        currencyCode: currencies.code,
        currencySign: currencies.sign,
        initialBalance: accounts.initialBalance,
        isActive: accounts.isActive,
        createdBy: accounts.createdBy,
        ownerName: users.name,
        canWrite: accountMembers.canWrite,
        balance:
          sql<number>`${accounts.initialBalance} + ${stats.total}`.mapWith(
            Number,
          ),
        usage: stats.usage,
        memberCount: sql<number>`(${db
          .select({ count: count() })
          .from(members)
          .where(
            and(eq(members.accountId, accounts.id), isNull(members.deletedAt)),
          )})`.mapWith(Number),
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
      // the code settles "Cash" against "Cash", so new accounts keep one order
      .orderBy(
        desc(stats.usage),
        asc(accounts.name),
        asc(currencies.code),
        asc(accounts.id),
      )
  );
};

export type AccountRow = Awaited<ReturnType<typeof readableAccounts>>[number];

const present = (userId: string) => (row: AccountRow) => ({
  ...row,
  isOwn: row.createdBy === userId,
  isShared: row.memberCount > 1,
});

/** The Accounts page and selects: every readable non-debt account */
export const listAccounts = Effect.fn("accounts.list")(function* (
  userId: string,
) {
  const rows = yield* query((db) =>
    readableAccounts(db, userId, ne(accounts.type, "debt")),
  );

  return rows.map(present(userId));
});

export const listCurrencies = Effect.fn("accounts.listCurrencies")(
  function* () {
    return yield* query((db) =>
      db.select().from(currencies).orderBy(asc(currencies.code)),
    );
  },
);

const friendlyUniqueError = catchUniqueViolation(
  "accounts_name_currency_owner_live_uq",
  () => badRequest("account_name_not_unique"),
);

export const createAccount = Effect.fn("accounts.create")(
  function* (userId: string, input: AccountInput) {
    return yield* insertAccount({ userId, values: input });
  },
  transaction,
  friendlyUniqueError,
);

/** Writable, not a debt account (those are system-managed) */
const requireEditableAccount = Effect.fnUntraced(function* (
  userId: string,
  id: string,
) {
  // locked so the checks below and the caller's change see the same row, and
  // a concurrent write into the account either finishes first or finds it gone
  const access = (yield* accountAccess(userId, [id], "update")).get(id);

  if (!access?.canWrite) {
    return yield* forbidden();
  }

  if (access.type === "debt") {
    return yield* forbidden("account_is_debt");
  }

  return access;
});

/** Any live transaction (submitted or planned) or live schedule */
const accountInUse = Effect.fnUntraced(function* (id: string) {
  const [row] = yield* query((db) =>
    db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(eq(transactions.accountId, id), isNull(transactions.deletedAt)),
      )
      .limit(1),
  );

  if (row) {
    return true;
  }

  const [schedule] = yield* query((db) =>
    db
      .select({ id: plannedTransactions.id })
      .from(plannedTransactions)
      .where(
        and(
          eq(plannedTransactions.accountId, id),
          isNull(plannedTransactions.deletedAt),
        ),
      )
      .limit(1),
  );

  return schedule !== undefined;
});

export const updateAccount = Effect.fn("accounts.update")(
  function* (userId: string, input: AccountInput & { id: string }) {
    const current = yield* requireEditableAccount(userId, input.id);

    if (
      current.currencyId !== input.currencyId &&
      (yield* accountInUse(input.id))
    ) {
      return yield* badRequest("account_currency_locked");
    }

    const { id, ...values } = input;
    const [updated] = yield* query((db) =>
      db
        .update(accounts)
        .set({ ...values, name: values.name.trim() })
        .where(eq(accounts.id, id))
        .returning(),
    );

    yield* audit({
      entityType: "account",
      entityId: id,
      action: "update",
      userId,
      payload: input,
    });

    return updated;
  },
  transaction,
  friendlyUniqueError,
);

export const setAccountActive = Effect.fn("accounts.setActive")(function* (
  userId: string,
  input: { id: string; isActive: boolean },
) {
  yield* requireEditableAccount(userId, input.id);

  yield* query((db) =>
    db
      .update(accounts)
      .set({ isActive: input.isActive })
      .where(eq(accounts.id, input.id)),
  );

  yield* audit({
    entityType: "account",
    entityId: input.id,
    action: "update",
    userId,
    payload: input,
  });
}, transaction);

/**
 * Soft delete, allowed only for an unused account: deleting one with
 * transactions would silently hide them, so the user is told to deactivate.
 */
export const deleteAccount = Effect.fn("accounts.delete")(function* (
  userId: string,
  id: string,
) {
  yield* requireEditableAccount(userId, id);

  if (yield* accountInUse(id)) {
    return yield* badRequest("account_has_transactions");
  }

  const at = yield* now;

  yield* query((db) =>
    db.update(accounts).set({ deletedAt: at }).where(eq(accounts.id, id)),
  );
  yield* query((db) =>
    db
      .update(accountMembers)
      .set({ deletedAt: at })
      .where(
        and(eq(accountMembers.accountId, id), isNull(accountMembers.deletedAt)),
      ),
  );

  yield* audit({
    entityType: "account",
    entityId: id,
    action: "delete",
    userId,
    payload: { id },
  });
}, transaction);

/**
 * The user's debt account for a currency, created on first use and named
 * "Debts" in the user's stored locale. An advisory lock serialises concurrent
 * first debts, and the partial unique index backs it up. Runs inside the
 * caller's transaction (the lock is transaction-scoped).
 */
export const getOrCreateDebtAccount = Effect.fn("accounts.getOrCreateDebt")(
  function* (userId: string, currencyId: string) {
    const find = query((db) =>
      db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.createdBy, userId),
            eq(accounts.currencyId, currencyId),
            eq(accounts.type, "debt"),
            isNull(accounts.deletedAt),
          ),
        ),
    ).pipe(Effect.map(([row]) => row?.id));

    const existing = yield* find;

    if (existing) {
      return existing;
    }

    yield* query((db) =>
      db.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`debt-account:${userId}:${currencyId}`}))`,
      ),
    );

    const raced = yield* find;

    if (raced) {
      return raced;
    }

    const [user] = yield* query((db) =>
      db
        .select({ locale: users.locale })
        .from(users)
        .where(eq(users.id, userId)),
    );
    const t = yield* serverTranslator(user?.locale === "en" ? "en" : "uk");

    // the name only has to be unique per (name, currency, owner), and a user
    // may already own a regular account called "Debts": suffix until it fits
    const base = t("seed.debts");
    const takenRows = yield* query((db) =>
      db
        .select({ name: accounts.name })
        .from(accounts)
        .where(
          and(
            eq(accounts.createdBy, userId),
            eq(accounts.currencyId, currencyId),
            isNull(accounts.deletedAt),
            or(eq(accounts.name, base), like(accounts.name, `${base} (%)`)),
          ),
        ),
    );
    const taken = new Set(takenRows.map((row) => row.name));
    let name = base;

    for (let n = 2; taken.has(name); n++) {
      name = `${base} (${n})`;
    }

    const account = yield* insertAccount({
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
  },
);
