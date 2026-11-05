import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import type { TransactionInput } from "~/lib/validators/transactions";
import { query, transaction } from "~/server/db/database";
import { categories, categoryMembers, users } from "~/server/db/schema";
import { today } from "~/server/lib/clock";
import { badRequest, forbidden } from "~/server/lib/errors";
import { serverTranslator } from "~/server/lib/i18n";
import { requireWritableAccounts } from "~/server/services/access";
import {
  balancesOf,
  insertLegs,
  prepareLegs,
} from "~/server/services/transactions";

/** Several transactions in one call, inserted in one DB transaction */
export const bulkCreate = Effect.fn("bulk.create")(function* (
  userId: string,
  items: readonly TransactionInput[],
) {
  const accountIds = new Set<string>();
  let created = 0;

  for (const item of items) {
    const { legs } = yield* prepareLegs(userId, item);
    yield* insertLegs(userId, legs);

    for (const leg of legs) {
      accountIds.add(leg.accountId);
    }

    created += 1;
  }

  return { created, balances: yield* balancesOf([...accountIds]) };
}, transaction);

/** One part of a split adjustment; the kind decides the stored sign */
export type AdjustmentSplit = {
  kind: "expense" | "income";
  amount: number;
  categoryId: string | null;
};

/**
 * Makes an account's balance equal `actualBalance`. With `splits`, each one
 * is booked as its own expense or income, and their net must equal the
 * difference (`adjust_balance_changed` otherwise, e.g. when the balance moved
 * since the form loaded). Without, one row for the difference goes to the
 * user's seeded "Adjustment" category (or none if it's gone). Nothing to
 * book creates nothing. The account row is locked so two adjustments can't
 * both compute from the same balance.
 */
export const adjustBalance = Effect.fn("bulk.adjustBalance")(function* (
  userId: string,
  input: {
    accountId: string;
    actualBalance: number;
    date?: string | null;
    splits?: readonly AdjustmentSplit[] | null;
  },
) {
  // an exclusive lock, so the balance read below stays current until the
  // adjustment is inserted
  const access = yield* requireWritableAccounts(
    userId,
    [input.accountId],
    "update",
  );

  if (access.get(input.accountId)?.type === "debt") {
    return yield* forbidden("account_is_debt");
  }

  const [current] = yield* balancesOf([input.accountId]);
  const difference = input.actualBalance - (current?.balance ?? 0);

  const [user] = yield* query((db) =>
    db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)),
  );
  const t = yield* serverTranslator(user?.locale === "en" ? "en" : "uk");
  const date = input.date ?? (yield* today);

  if (input.splits) {
    const net = input.splits.reduce(
      (sum, split) =>
        sum + (split.kind === "income" ? split.amount : -split.amount),
      0,
    );

    if (net !== difference) {
      return yield* badRequest("adjust_balance_changed");
    }

    if (input.splits.length === 0) {
      return { created: false as const, difference: 0 };
    }

    const ids: string[] = [];

    for (const split of input.splits) {
      const { legs } = yield* prepareLegs(userId, {
        kind: split.kind,
        date,
        amount: split.amount,
        accountId: input.accountId,
        categoryId: split.categoryId,
        counterparty: null,
        comment: t("adjust.comment"),
      });
      const inserted = yield* insertLegs(userId, legs);
      ids.push(...inserted.ids);
    }

    return { created: true as const, difference, ids };
  }

  if (difference === 0) {
    return { created: false as const, difference: 0 };
  }

  const [adjustment] = yield* query((db) =>
    db
      .select({ id: categories.id })
      .from(categories)
      .innerJoin(
        categoryMembers,
        and(
          eq(categoryMembers.categoryId, categories.id),
          eq(categoryMembers.userId, userId),
          eq(categoryMembers.canWrite, true),
          isNull(categoryMembers.deletedAt),
        ),
      )
      .where(
        and(
          eq(categories.createdBy, userId),
          eq(categories.seedKey, "adjustment"),
          isNull(categories.deletedAt),
          difference < 0
            ? eq(categories.isExpense, true)
            : eq(categories.isIncome, true),
        ),
      )
      .limit(1),
  );

  const adjustmentInput: TransactionInput = {
    kind: difference < 0 ? "expense" : "income",
    date,
    amount: Math.abs(difference),
    accountId: input.accountId,
    categoryId: adjustment?.id ?? null,
    counterparty: null,
    comment: t("adjust.comment"),
  };

  const { legs } = yield* prepareLegs(userId, adjustmentInput);
  const { ids } = yield* insertLegs(userId, legs);

  return { created: true as const, difference, id: ids[0] };
}, transaction);
