import { Effect } from "effect";

import type { Locale } from "~/i18n/config";
import { query } from "~/server/db/database";
import { currencies } from "~/server/db/schema";
import { serverTranslator } from "~/server/lib/i18n";
import { insertAccount } from "~/server/services/accounts";
import { insertCategory } from "~/server/services/categories";

export const SEED_CATEGORIES = [
  { key: "adjustment", isExpense: true, isIncome: true },
  { key: "animals", isExpense: true, isIncome: false },
  { key: "car", isExpense: true, isIncome: false },
  { key: "clothing", isExpense: true, isIncome: false },
  { key: "commuting", isExpense: true, isIncome: false },
  { key: "devices", isExpense: true, isIncome: false },
  { key: "entertainment", isExpense: true, isIncome: false },
  { key: "gifts", isExpense: true, isIncome: false },
  { key: "groceries", isExpense: true, isIncome: false },
  { key: "health", isExpense: true, isIncome: false },
  { key: "home", isExpense: true, isIncome: false },
  { key: "income", isExpense: false, isIncome: true },
  { key: "salary", isExpense: false, isIncome: true },
  { key: "self_care", isExpense: true, isIncome: false },
  { key: "subscriptions", isExpense: true, isIncome: false },
] as const;

/**
 * Gives a new user one "Cash" account per currency and the default
 * categories, named in their locale. Runs inside the registration transaction.
 */
export const seedUserData = Effect.fn("seed.userData")(function* (
  userId: string,
  locale: Locale,
) {
  const t = yield* serverTranslator(locale);
  const allCurrencies = yield* query((db) =>
    db.select({ id: currencies.id }).from(currencies).orderBy(currencies.code),
  );

  for (const currency of allCurrencies) {
    yield* insertAccount({
      userId,
      values: {
        name: t("seed.cash"),
        type: "cash",
        currencyId: currency.id,
        initialBalance: 0,
        isActive: true,
      },
    });
  }

  for (const category of SEED_CATEGORIES) {
    yield* insertCategory({
      userId,
      values: {
        name: t(`seed.categories.${category.key}`),
        parentId: null,
        isExpense: category.isExpense,
        isIncome: category.isIncome,
        seedKey: category.key,
      },
    });
  }
});
