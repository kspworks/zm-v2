import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Locale } from "~/i18n/config";
import type { CategoryInput } from "~/lib/validators/categories";
import type { DbOrTx } from "~/server/db";
import { categories, categoryMembers, users } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { appError } from "~/server/lib/errors";
import {
  categoryAccess,
  requireWritableCategory,
} from "~/server/services/access";

export type CategoryInsert = {
  name: string;
  parentId: string | null;
  isExpense: boolean;
  isIncome: boolean;
  seedKey?: string | null;
  importId?: string | null;
};

/** Inserts a category plus the creator's read+write member row and audit row */
export const insertCategory = async (
  tx: DbOrTx,
  { userId, values }: { userId: string; values: CategoryInsert },
) => {
  const [category] = await tx
    .insert(categories)
    .values({ ...values, name: values.name.trim(), createdBy: userId })
    .returning();

  if (!category) {
    throw new Error("Category insert returned no row");
  }

  await tx.insert(categoryMembers).values({
    categoryId: category.id,
    userId,
    canRead: true,
    canWrite: true,
  });

  await audit(tx, {
    entityType: "category",
    entityId: category.id,
    action: "create",
    userId,
    payload: values,
  });

  return category;
};

const parent = alias(categories, "parent");
const child = alias(categories, "child");
const members = alias(categoryMembers, "cm");

/** Readable categories with the parent's name, rights and sharing info */
export const listCategories = async (
  db: DbOrTx,
  userId: string,
  locale: Locale = "uk",
) => {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      parentName: parent.name,
      isExpense: categories.isExpense,
      isIncome: categories.isIncome,
      importId: categories.importId,
      seedKey: categories.seedKey,
      createdBy: categories.createdBy,
      ownerName: users.name,
      canWrite: categoryMembers.canWrite,
      memberCount: sql<number>`(${db
        .select({ count: count() })
        .from(members)
        .where(
          and(eq(members.categoryId, categories.id), isNull(members.deletedAt)),
        )})`.mapWith(Number),
      childCount: sql<number>`(${db
        .select({ count: count() })
        .from(child)
        .where(
          and(eq(child.parentId, categories.id), isNull(child.deletedAt)),
        )})`.mapWith(Number),
    })
    .from(categories)
    .innerJoin(
      categoryMembers,
      and(
        eq(categoryMembers.categoryId, categories.id),
        eq(categoryMembers.userId, userId),
        isNull(categoryMembers.deletedAt),
        eq(categoryMembers.canRead, true),
      ),
    )
    .innerJoin(users, eq(users.id, categories.createdBy))
    .leftJoin(
      parent,
      and(eq(parent.id, categories.parentId), isNull(parent.deletedAt)),
    )
    .where(isNull(categories.deletedAt));

  const collator = new Intl.Collator(locale);

  return rows
    .map((row) => ({
      ...row,
      displayName: row.parentName
        ? `${row.parentName} / ${row.name}`
        : row.name,
      isOwn: row.createdBy === userId,
      isShared: row.memberCount > 1,
    }))
    .sort(
      (a, b) =>
        collator.compare(a.displayName, b.displayName) ||
        a.id.localeCompare(b.id),
    );
};

/**
 * A parent must exist, be readable by the user and be top-level. Every one
 * of those failures gets the same answer, so ids can't be probed.
 */
const assertParentAllowed = async (
  db: DbOrTx,
  userId: string,
  parentId: string,
  selfId?: string,
) => {
  if (parentId === selfId) {
    throw appError("BAD_REQUEST", "fields_integrity_self_parent");
  }

  const access = (await categoryAccess(db, userId, [parentId])).get(parentId);

  if (!access?.canRead || access.parentId !== null) {
    throw appError("BAD_REQUEST", "fields_integrity_parent_not_allowed");
  }
};

/**
 * Locks the rows involved in a hierarchy change (in id order, so concurrent
 * callers can't deadlock): the two-level rule reads one row and writes
 * another, and must not interleave with a concurrent change.
 */
const lockCategories = async (db: DbOrTx, ids: (string | null)[]) => {
  const present = [...new Set(ids.filter((id): id is string => !!id))];

  if (present.length > 0) {
    await db
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, present))
      .orderBy(asc(categories.id))
      .for("update");
  }
};

const hasLiveChildren = async (db: DbOrTx, id: string) => {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.parentId, id), isNull(categories.deletedAt)))
    .limit(1);

  return row !== undefined;
};

export const createCategory = (
  db: DbOrTx,
  userId: string,
  input: CategoryInput,
) =>
  db.transaction(async (tx) => {
    if (input.parentId) {
      await lockCategories(tx, [input.parentId]);
      await assertParentAllowed(tx, userId, input.parentId);
    }

    return insertCategory(tx, { userId, values: input });
  });

export const updateCategory = (
  db: DbOrTx,
  userId: string,
  input: CategoryInput & { id: string },
) =>
  db.transaction(async (tx) => {
    await lockCategories(tx, [input.id, input.parentId]);
    await requireWritableCategory(tx, userId, input.id);

    if (input.parentId) {
      await assertParentAllowed(tx, userId, input.parentId, input.id);

      if (await hasLiveChildren(tx, input.id)) {
        throw appError("BAD_REQUEST", "category_parent_has_children");
      }
    }

    const { id, ...values } = input;
    const [updated] = await tx
      .update(categories)
      .set({ ...values, name: values.name.trim() })
      .where(eq(categories.id, id))
      .returning();

    await audit(tx, {
      entityType: "category",
      entityId: id,
      action: "update",
      userId,
      payload: input,
    });

    return updated;
  });

/**
 * Soft delete. A parent with live children can't go; transactions keep
 * pointing at a deleted category and show it as "Deleted category".
 */
export const deleteCategory = (db: DbOrTx, userId: string, id: string) =>
  db.transaction(async (tx) => {
    await lockCategories(tx, [id]);
    await requireWritableCategory(tx, userId, id);

    if (await hasLiveChildren(tx, id)) {
      throw appError("BAD_REQUEST", "category_has_children");
    }

    const at = new Date();

    await tx
      .update(categories)
      .set({ deletedAt: at })
      .where(eq(categories.id, id));
    await tx
      .update(categoryMembers)
      .set({ deletedAt: at })
      .where(
        and(
          eq(categoryMembers.categoryId, id),
          isNull(categoryMembers.deletedAt),
        ),
      );

    await audit(tx, {
      entityType: "category",
      entityId: id,
      action: "delete",
      userId,
      payload: { id },
    });
  });
