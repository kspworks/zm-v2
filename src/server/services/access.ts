import { and, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";

import { query } from "~/server/db/database";
import {
  accountMembers,
  accounts,
  categories,
  categoryMembers,
} from "~/server/db/schema";
import { forbidden } from "~/server/lib/errors";

export type AccountAccess = {
  id: string;
  type: (typeof accounts.$inferSelect)["type"];
  currencyId: string;
  isActive: boolean;
  createdBy: string;
  name: string;
  canRead: boolean;
  canWrite: boolean;
};

/**
 * Row lock taken on the account rows for the rest of the caller's
 * transaction: "share" for writes into an account (inserting or moving
 * transactions and schedules), "update" for changes to the account itself.
 * They conflict, so an account can't be deleted between a write's access
 * check and its insert, and a write waiting on a deletion re-reads the row
 * and finds it gone.
 */
export type AccountLock = "share" | "update";

/**
 * Live accounts with the user's live membership, keyed by id. With `lock`,
 * the account rows are locked in id order, so concurrent writers touching
 * the same accounts can't deadlock.
 */
export const accountAccess = Effect.fn("access.accountAccess")(function* (
  userId: string,
  ids: readonly string[],
  lock?: AccountLock,
) {
  const unique = [...new Set(ids)];

  if (unique.length === 0) {
    return new Map<string, AccountAccess>();
  }

  const rows: AccountAccess[] = yield* query((db) => {
    const select = db
      .select({
        id: accounts.id,
        type: accounts.type,
        currencyId: accounts.currencyId,
        isActive: accounts.isActive,
        createdBy: accounts.createdBy,
        name: accounts.name,
        canRead: accountMembers.canRead,
        canWrite: accountMembers.canWrite,
      })
      .from(accounts)
      .innerJoin(
        accountMembers,
        and(
          eq(accountMembers.accountId, accounts.id),
          eq(accountMembers.userId, userId),
          isNull(accountMembers.deletedAt),
        ),
      )
      .where(and(inArray(accounts.id, unique), isNull(accounts.deletedAt)))
      .orderBy(accounts.id);

    return lock ? select.for(lock, { of: accounts }) : select;
  });

  return new Map(rows.map((row) => [row.id, row]));
});

/**
 * Every id must be a live account the user can write; returns the rows,
 * locked for the rest of the caller's transaction (see AccountLock)
 */
export const requireWritableAccounts = Effect.fn(
  "access.requireWritableAccounts",
)(function* (
  userId: string,
  ids: readonly string[],
  lock: AccountLock = "share",
) {
  const access = yield* accountAccess(userId, ids, lock);

  for (const id of ids) {
    if (!access.get(id)?.canWrite) {
      return yield* forbidden();
    }
  }

  return access;
});

export type CategoryAccess = {
  id: string;
  parentId: string | null;
  isExpense: boolean;
  isIncome: boolean;
  createdBy: string;
  canRead: boolean;
  canWrite: boolean;
};

export const categoryAccess = Effect.fn("access.categoryAccess")(function* (
  userId: string,
  ids: readonly string[],
) {
  const unique = [...new Set(ids)];

  if (unique.length === 0) {
    return new Map<string, CategoryAccess>();
  }

  const rows: CategoryAccess[] = yield* query((db) =>
    db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        isExpense: categories.isExpense,
        isIncome: categories.isIncome,
        createdBy: categories.createdBy,
        canRead: categoryMembers.canRead,
        canWrite: categoryMembers.canWrite,
      })
      .from(categories)
      .innerJoin(
        categoryMembers,
        and(
          eq(categoryMembers.categoryId, categories.id),
          eq(categoryMembers.userId, userId),
          isNull(categoryMembers.deletedAt),
        ),
      )
      .where(and(inArray(categories.id, unique), isNull(categories.deletedAt))),
  );

  return new Map(rows.map((row) => [row.id, row]));
});

export const requireWritableCategory = Effect.fn(
  "access.requireWritableCategory",
)(function* (userId: string, id: string) {
  const access = (yield* categoryAccess(userId, [id])).get(id);

  if (!access?.canWrite) {
    return yield* forbidden();
  }

  return access;
});
