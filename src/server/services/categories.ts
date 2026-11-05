import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";

import type { Locale } from "~/i18n/config";
import type { CategoryInput } from "~/lib/validators/categories";
import { query, transaction } from "~/server/db/database";
import { categories, categoryMembers, users } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now } from "~/server/lib/clock";
import { badRequest } from "~/server/lib/errors";
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
export const insertCategory = Effect.fn("categories.insert")(function* ({
  userId,
  values,
}: {
  userId: string;
  values: CategoryInsert;
}) {
  const [category] = yield* query((db) =>
    db
      .insert(categories)
      .values({ ...values, name: values.name.trim(), createdBy: userId })
      .returning(),
  );

  if (!category) {
    return yield* Effect.die(new Error("Category insert returned no row"));
  }

  yield* query((db) =>
    db.insert(categoryMembers).values({
      categoryId: category.id,
      userId,
      canRead: true,
      canWrite: true,
    }),
  );

  yield* audit({
    entityType: "category",
    entityId: category.id,
    action: "create",
    userId,
    payload: values,
  });

  return category;
});

const parent = alias(categories, "parent");
const child = alias(categories, "child");
const members = alias(categoryMembers, "cm");

/** Readable categories with the parent's name, rights and sharing info */
export const listCategories = Effect.fn("categories.list")(function* (
  userId: string,
  locale: Locale = "uk",
) {
  const rows = yield* query((db) =>
    db
      .select({
        id: categories.id,
        name: categories.name,
        parentId: categories.parentId,
        parentName: parent.name,
        isExpense: categories.isExpense,
        isIncome: categories.isIncome,
        seedKey: categories.seedKey,
        createdBy: categories.createdBy,
        ownerName: users.name,
        canWrite: categoryMembers.canWrite,
        memberCount: sql<number>`(${db
          .select({ count: count() })
          .from(members)
          .where(
            and(
              eq(members.categoryId, categories.id),
              isNull(members.deletedAt),
            ),
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
      .where(isNull(categories.deletedAt)),
  );

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
});

/**
 * A parent must exist, be readable by the user and be top-level. Every one
 * of those failures gets the same answer, so ids can't be probed; only a
 * category naming itself as parent gets its own key.
 */
const assertParentAllowed = Effect.fnUntraced(function* (
  userId: string,
  parentId: string,
  selfId?: string,
) {
  if (parentId === selfId) {
    return yield* badRequest("fields_integrity_self_parent");
  }

  const access = (yield* categoryAccess(userId, [parentId])).get(parentId);

  if (!access?.canRead || access.parentId !== null) {
    return yield* badRequest("fields_integrity_parent_not_allowed");
  }
});

/**
 * Locks the rows involved in a hierarchy change (in id order, so concurrent
 * callers can't deadlock): the two-level rule reads one row and writes
 * another, and must not interleave with a concurrent change.
 */
const lockCategories = Effect.fnUntraced(function* (
  ids: readonly (string | null)[],
) {
  const present = [...new Set(ids.filter((id): id is string => !!id))];

  if (present.length > 0) {
    yield* query((db) =>
      db
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.id, present))
        .orderBy(asc(categories.id))
        .for("update"),
    );
  }
});

const hasLiveChildren = Effect.fnUntraced(function* (id: string) {
  const [row] = yield* query((db) =>
    db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.parentId, id), isNull(categories.deletedAt)))
      .limit(1),
  );

  return row !== undefined;
});

export const createCategory = Effect.fn("categories.create")(function* (
  userId: string,
  input: CategoryInput,
) {
  if (input.parentId) {
    yield* lockCategories([input.parentId]);
    yield* assertParentAllowed(userId, input.parentId);
  }

  return yield* insertCategory({ userId, values: input });
}, transaction);

export const updateCategory = Effect.fn("categories.update")(function* (
  userId: string,
  input: CategoryInput & { id: string },
) {
  yield* lockCategories([input.id, input.parentId]);
  yield* requireWritableCategory(userId, input.id);

  if (input.parentId) {
    yield* assertParentAllowed(userId, input.parentId, input.id);

    if (yield* hasLiveChildren(input.id)) {
      return yield* badRequest("category_parent_has_children");
    }
  }

  const { id, ...values } = input;
  const [updated] = yield* query((db) =>
    db
      .update(categories)
      .set({ ...values, name: values.name.trim() })
      .where(eq(categories.id, id))
      .returning(),
  );

  yield* audit({
    entityType: "category",
    entityId: id,
    action: "update",
    userId,
    payload: input,
  });

  return updated;
}, transaction);

/**
 * Soft delete. A parent with live children can't go; transactions keep
 * pointing at a deleted category and show it as "Deleted category".
 */
export const deleteCategory = Effect.fn("categories.delete")(function* (
  userId: string,
  id: string,
) {
  yield* lockCategories([id]);
  yield* requireWritableCategory(userId, id);

  if (yield* hasLiveChildren(id)) {
    return yield* badRequest("category_has_children");
  }

  const at = yield* now;

  yield* query((db) =>
    db.update(categories).set({ deletedAt: at }).where(eq(categories.id, id)),
  );
  yield* query((db) =>
    db
      .update(categoryMembers)
      .set({ deletedAt: at })
      .where(
        and(
          eq(categoryMembers.categoryId, id),
          isNull(categoryMembers.deletedAt),
        ),
      ),
  );

  yield* audit({
    entityType: "category",
    entityId: id,
    action: "delete",
    userId,
    payload: { id },
  });
}, transaction);
