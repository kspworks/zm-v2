import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";

import { monthOf } from "~/lib/period";
import type { BudgetInput } from "~/lib/validators/budgets";
import { query, transaction } from "~/server/db/database";
import {
  accountMembers,
  accounts,
  budgets,
  categories,
  currencies,
  transactions,
} from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now, today } from "~/server/lib/clock";
import { badRequest, forbidden, notFound } from "~/server/lib/errors";
import { categoryAccess } from "~/server/services/access";

const parent = alias(categories, "parent");

/** Expenses this calendar month per leaf category and currency */
const spentThisMonth = Effect.fnUntraced(function* (
  userId: string,
  date: string,
) {
  const month = monthOf(date);

  return yield* query((db) =>
    db
      .select({
        categoryId: transactions.categoryId,
        parentId: categories.parentId,
        currencyId: accounts.currencyId,
        spent: sql<number>`-sum(${transactions.amount})`.mapWith(Number),
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .innerJoin(
        accountMembers,
        and(
          eq(accountMembers.accountId, accounts.id),
          eq(accountMembers.userId, userId),
          eq(accountMembers.canRead, true),
          isNull(accountMembers.deletedAt),
        ),
      )
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.kind, "expense"),
          eq(transactions.isPlanned, false),
          isNull(transactions.deletedAt),
          isNull(accounts.deletedAt),
          gte(transactions.date, month.startDate),
          lte(transactions.date, month.endDate),
        ),
      )
      .groupBy(
        transactions.categoryId,
        categories.parentId,
        accounts.currencyId,
      ),
  );
});

/**
 * The user's budgets with what they have spent this month, fullest first. A
 * budget on a parent category counts its subcategories too.
 */
export const listBudgets = Effect.fn("budgets.list")(function* (
  userId: string,
) {
  const date = yield* today;
  const [rows, spent] = yield* Effect.all(
    [
      query((db) =>
        db
          .select({
            id: budgets.id,
            amount: budgets.amount,
            categoryId: budgets.categoryId,
            categoryName: categories.name,
            parentName: parent.name,
            currencyId: budgets.currencyId,
            currencyCode: currencies.code,
            currencySign: currencies.sign,
          })
          .from(budgets)
          .innerJoin(categories, eq(categories.id, budgets.categoryId))
          .leftJoin(parent, eq(parent.id, categories.parentId))
          .innerJoin(currencies, eq(currencies.id, budgets.currencyId))
          .where(
            and(
              eq(budgets.userId, userId),
              isNull(budgets.deletedAt),
              isNull(categories.deletedAt),
            ),
          ),
      ),
      spentThisMonth(userId, date),
    ],
    { concurrency: "unbounded" },
  );

  return rows
    .map((row) => ({
      ...row,
      spent: spent
        .filter(
          (entry) =>
            entry.currencyId === row.currencyId &&
            (entry.categoryId === row.categoryId ||
              entry.parentId === row.categoryId),
        )
        .reduce((sum, entry) => sum + entry.spent, 0),
    }))
    .sort((a, b) => b.spent / b.amount - a.spent / a.amount);
});

/** Sets the monthly limit of a category in a currency, new or not */
export const saveBudget = Effect.fn("budgets.save")(function* (
  userId: string,
  input: BudgetInput,
) {
  const access = yield* categoryAccess(userId, [input.categoryId]);

  if (!access.has(input.categoryId)) {
    return yield* forbidden();
  }

  const [category] = yield* query((db) =>
    db
      .select({ isExpense: categories.isExpense })
      .from(categories)
      .where(eq(categories.id, input.categoryId)),
  );

  if (!category?.isExpense) {
    return yield* badRequest("fields_integrity_not_expense_category");
  }

  const [currency] = yield* query((db) =>
    db
      .select({ id: currencies.id })
      .from(currencies)
      .where(eq(currencies.id, input.currencyId)),
  );

  if (!currency) {
    return yield* badRequest("invalid_value");
  }

  const live = and(
    eq(budgets.userId, userId),
    eq(budgets.categoryId, input.categoryId),
    eq(budgets.currencyId, input.currencyId),
    isNull(budgets.deletedAt),
  );
  const [existing] = yield* query((db) =>
    db.select({ id: budgets.id }).from(budgets).where(live),
  );

  const [saved] = yield* query((db) =>
    db
      .insert(budgets)
      .values({ userId, ...input })
      .onConflictDoUpdate({
        target: [budgets.userId, budgets.categoryId, budgets.currencyId],
        targetWhere: isNull(budgets.deletedAt),
        set: { amount: input.amount },
      })
      .returning({ id: budgets.id }),
  );

  if (!saved) {
    return yield* Effect.die("the upsert returns its row");
  }

  yield* audit({
    entityType: "budget",
    entityId: saved.id,
    action: existing ? "update" : "create",
    userId,
    payload: input,
  });

  return saved;
}, transaction);

export const deleteBudget = Effect.fn("budgets.delete")(function* (
  userId: string,
  id: string,
) {
  const at = yield* now;
  const [row] = yield* query((db) =>
    db
      .update(budgets)
      .set({ deletedAt: at })
      .where(
        and(
          eq(budgets.id, id),
          eq(budgets.userId, userId),
          isNull(budgets.deletedAt),
        ),
      )
      .returning({ id: budgets.id }),
  );

  if (!row) {
    return yield* notFound();
  }

  yield* audit({
    entityType: "budget",
    entityId: id,
    action: "delete",
    userId,
    payload: { id },
  });

  return { id };
}, transaction);
