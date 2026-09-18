import { and, eq, inArray, isNull } from "drizzle-orm";

import type { DbOrTx } from "~/server/db";
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

/** Live accounts with the user's live membership, keyed by id */
export const accountAccess = async (
  db: DbOrTx,
  userId: string,
  ids: string[],
): Promise<Map<string, AccountAccess>> => {
  const unique = [...new Set(ids)];

  if (unique.length === 0) {
    return new Map();
  }

  const rows = await db
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
    .where(and(inArray(accounts.id, unique), isNull(accounts.deletedAt)));

  return new Map(rows.map((row) => [row.id, row]));
};

/** Every id must be a live account the user can write; returns the rows */
export const requireWritableAccounts = async (
  db: DbOrTx,
  userId: string,
  ids: string[],
): Promise<Map<string, AccountAccess>> => {
  const access = await accountAccess(db, userId, ids);

  for (const id of ids) {
    if (!access.get(id)?.canWrite) {
      throw forbidden();
    }
  }

  return access;
};

export type CategoryAccess = {
  id: string;
  parentId: string | null;
  isExpense: boolean;
  isIncome: boolean;
  createdBy: string;
  canRead: boolean;
  canWrite: boolean;
};

export const categoryAccess = async (
  db: DbOrTx,
  userId: string,
  ids: string[],
): Promise<Map<string, CategoryAccess>> => {
  const unique = [...new Set(ids)];

  if (unique.length === 0) {
    return new Map();
  }

  const rows = await db
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
    .where(and(inArray(categories.id, unique), isNull(categories.deletedAt)));

  return new Map(rows.map((row) => [row.id, row]));
};

export const requireWritableCategory = async (
  db: DbOrTx,
  userId: string,
  id: string,
): Promise<CategoryAccess> => {
  const access = (await categoryAccess(db, userId, [id])).get(id);

  if (!access?.canWrite) {
    throw forbidden();
  }

  return access;
};
