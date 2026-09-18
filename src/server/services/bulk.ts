import { and, eq, isNull } from "drizzle-orm";

import type { TransactionInput } from "~/lib/validators/transactions";
import type { DbOrTx } from "~/server/db";
import {
  accounts,
  categories,
  categoryMembers,
  users,
} from "~/server/db/schema";
import { today } from "~/server/lib/clock";
import { forbidden } from "~/server/lib/errors";
import { getServerTranslator } from "~/server/lib/i18n";
import { requireWritableAccounts } from "~/server/services/access";
import {
  balancesOf,
  insertLegs,
  prepareLegs,
} from "~/server/services/transactions";

/** Several transactions in one call, inserted in one DB transaction */
export const bulkCreate = (
  db: DbOrTx,
  userId: string,
  items: TransactionInput[],
) =>
  db.transaction(async (tx) => {
    const accountIds = new Set<string>();
    let created = 0;

    for (const item of items) {
      const { legs } = await prepareLegs(tx, userId, item);
      await insertLegs(tx, userId, legs);

      for (const leg of legs) {
        accountIds.add(leg.accountId);
      }

      created += 1;
    }

    return { created, balances: await balancesOf(tx, [...accountIds]) };
  });

/**
 * Makes an account's balance equal `actualBalance` with one expense or
 * income for the difference, in the user's seeded "Adjustment" category (or
 * none if it's gone). A zero difference creates nothing. The account row is
 * locked so two adjustments can't both compute from the same balance.
 */
export const adjustBalance = (
  db: DbOrTx,
  userId: string,
  input: { accountId: string; actualBalance: number; date?: string | null },
) =>
  db.transaction(async (tx) => {
    const access = await requireWritableAccounts(tx, userId, [input.accountId]);

    if (access.get(input.accountId)?.type === "debt") {
      throw forbidden("account_is_debt");
    }

    await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, input.accountId))
      .for("update");

    const [current] = await balancesOf(tx, [input.accountId]);
    const difference = input.actualBalance - (current?.balance ?? 0);

    if (difference === 0) {
      return { created: false as const, difference: 0 };
    }

    const [adjustment] = await tx
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
      .limit(1);

    const [user] = await tx
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId));
    const t = await getServerTranslator(user?.locale === "en" ? "en" : "uk");

    const adjustmentInput: TransactionInput = {
      kind: difference < 0 ? "expense" : "income",
      date: input.date ?? today(),
      amount: Math.abs(difference),
      accountId: input.accountId,
      categoryId: adjustment?.id ?? null,
      counterparty: null,
      comment: t("adjust.comment"),
    };

    const { legs } = await prepareLegs(tx, userId, adjustmentInput);
    const { ids } = await insertLegs(tx, userId, legs);

    return { created: true as const, difference, id: ids[0] };
  });
