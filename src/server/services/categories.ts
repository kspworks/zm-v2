import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";

import type { Locale } from "~/i18n/config";
import type { CategoryInput } from "~/lib/validators/categories";
import type { DbOrTx } from "~/server/db";
import { query, transaction } from "~/server/db/database";
import {
  accountMembers,
  budgets,
  categories,
  categoryMembers,
  plannedTransactions,
  transactions,
  users,
} from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now } from "~/server/lib/clock";
import { badRequest, forbidden } from "~/server/lib/errors";
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
        createdAt: categories.createdAt,
        createdBy: categories.createdBy,
        ownerName: users.name,
        canWrite: categoryMembers.canWrite,
        isHidden: categoryMembers.isHidden,
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

/** Soft-deletes a category and every member row of it */
const softDelete = Effect.fnUntraced(function* (id: string) {
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
});

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

  yield* softDelete(id);

  yield* audit({
    entityType: "category",
    entityId: id,
    action: "delete",
    userId,
    payload: { id },
  });
}, transaction);

/**
 * "Delete and replace with": the source's transactions (deleted ones too,
 * so a restore lands on a live category) and schedules move to the target,
 * the user's own budgets follow, then the source is deleted. Only rows on
 * accounts the user can write move, the same rights an edit needs; on a
 * shared category, other members' rows stay as a plain delete leaves them.
 */
export const replaceCategory = Effect.fn("categories.replace")(function* (
  userId: string,
  input: { sourceId: string; targetId: string },
) {
  const { sourceId, targetId } = input;

  if (sourceId === targetId) {
    return yield* badRequest("category_replace_self");
  }

  yield* lockCategories([sourceId, targetId]);
  yield* requireWritableCategory(userId, sourceId);
  const target = yield* requireWritableCategory(userId, targetId);

  if (yield* hasLiveChildren(sourceId)) {
    return yield* badRequest("category_has_children");
  }

  // accounts the user can write: an edit of a row there is theirs to make
  const writableAccounts = (db: DbOrTx) =>
    db
      .select({ id: accountMembers.accountId })
      .from(accountMembers)
      .where(
        and(
          eq(accountMembers.userId, userId),
          eq(accountMembers.canWrite, true),
          isNull(accountMembers.deletedAt),
        ),
      );
  const movingTransactions = (db: DbOrTx) =>
    and(
      eq(transactions.categoryId, sourceId),
      inArray(transactions.accountId, writableAccounts(db)),
    );
  const movingSchedules = (db: DbOrTx) =>
    and(
      eq(plannedTransactions.categoryId, sourceId),
      inArray(plannedTransactions.accountId, writableAccounts(db)),
    );

  const kinds = yield* query((db) =>
    db
      .selectDistinct({ kind: transactions.kind })
      .from(transactions)
      .where(movingTransactions(db))
      .union(
        db
          .selectDistinct({ kind: plannedTransactions.kind })
          .from(plannedTransactions)
          .where(movingSchedules(db)),
      ),
  );

  if (
    kinds.some(
      ({ kind }) =>
        (kind === "expense" && !target.isExpense) ||
        (kind === "income" && !target.isIncome),
    )
  ) {
    return yield* badRequest("category_replace_kind_mismatch");
  }

  const moved = yield* query((db) =>
    db
      .update(transactions)
      .set({ categoryId: targetId })
      .where(movingTransactions(db))
      .returning({ id: transactions.id }),
  );
  const schedules = yield* query((db) =>
    db
      .update(plannedTransactions)
      .set({ categoryId: targetId })
      .where(movingSchedules(db))
      .returning({ id: plannedTransactions.id }),
  );

  yield* moveBudgets(userId, sourceId, target);
  yield* softDelete(sourceId);

  yield* audit({
    entityType: "category",
    entityId: sourceId,
    action: "delete",
    userId,
    payload: {
      replacedBy: targetId,
      transactions: moved.length,
      schedules: schedules.length,
    },
  });

  return { moved: moved.length };
}, transaction);

/**
 * The user's budgets on the source move to the target: a limit the target
 * already has in that currency grows by the source's, and a target that is
 * not an expense category can't have budgets, so they go.
 */
const moveBudgets = Effect.fnUntraced(function* (
  userId: string,
  sourceId: string,
  target: { id: string; isExpense: boolean },
) {
  const at = yield* now;
  const removed = yield* query((db) =>
    db
      .update(budgets)
      .set({ deletedAt: at })
      .where(
        and(
          eq(budgets.userId, userId),
          eq(budgets.categoryId, sourceId),
          isNull(budgets.deletedAt),
        ),
      )
      .returning({
        id: budgets.id,
        currencyId: budgets.currencyId,
        amount: budgets.amount,
      }),
  );

  for (const source of removed) {
    yield* audit({
      entityType: "budget",
      entityId: source.id,
      action: "delete",
      userId,
      payload: { id: source.id, replacedBy: target.id },
    });

    if (!target.isExpense) {
      continue;
    }

    const [existing] = yield* query((db) =>
      db
        .select({ id: budgets.id })
        .from(budgets)
        .where(
          and(
            eq(budgets.userId, userId),
            eq(budgets.categoryId, target.id),
            eq(budgets.currencyId, source.currencyId),
            isNull(budgets.deletedAt),
          ),
        ),
    );
    const [saved] = yield* query((db) =>
      db
        .insert(budgets)
        .values({
          userId,
          categoryId: target.id,
          currencyId: source.currencyId,
          amount: source.amount,
        })
        .onConflictDoUpdate({
          target: [budgets.userId, budgets.categoryId, budgets.currencyId],
          targetWhere: isNull(budgets.deletedAt),
          set: { amount: sql`${budgets.amount} + excluded.amount` },
        })
        .returning({ id: budgets.id, amount: budgets.amount }),
    );

    if (!saved) {
      return yield* Effect.die("the upsert returns its row");
    }

    yield* audit({
      entityType: "budget",
      entityId: saved.id,
      action: existing ? "update" : "create",
      userId,
      payload: {
        categoryId: target.id,
        currencyId: source.currencyId,
        amount: saved.amount,
      },
    });
  }
});

/**
 * Hides a category from this user's pickers, or shows it again. A personal
 * choice kept on the user's own member row, so read access is enough and
 * other members are not affected.
 */
export const setCategoryHidden = Effect.fn("categories.setHidden")(function* (
  userId: string,
  input: { id: string; hidden: boolean },
) {
  const access = (yield* categoryAccess(userId, [input.id])).get(input.id);

  if (!access?.canRead) {
    return yield* forbidden();
  }

  yield* query((db) =>
    db
      .update(categoryMembers)
      .set({ isHidden: input.hidden })
      .where(
        and(
          eq(categoryMembers.categoryId, input.id),
          eq(categoryMembers.userId, userId),
          isNull(categoryMembers.deletedAt),
        ),
      ),
  );

  yield* audit({
    entityType: "category",
    entityId: input.id,
    action: "update",
    userId,
    payload: input,
  });
}, transaction);
