import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import {
  CURRENCY,
  createUser,
  makeAccount,
  makeCategory,
} from "../helpers/fixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const spend = (
  user: { id: string },
  accountId: string,
  categoryId: string,
  amount: number,
  date: string,
) =>
  callerFor(user).transactions.create({
    kind: "expense",
    date,
    amount,
    accountId,
    categoryId,
    comment: null,
  });

describe("budgets", () => {
  it("counts this month's spending in its currency, subcategories included", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const dollars = await makeAccount(user, { currencyId: CURRENCY.USD });
    const food = await makeCategory(user);
    const market = await makeCategory(user, { parentId: food.id });

    await spend(user, account.id, food.id, 3000, "2026-03-02");
    await spend(user, account.id, market.id, 2000, "2026-03-10");
    // last month, and another currency: neither counts
    await spend(user, account.id, food.id, 9000, "2026-02-27");
    await spend(user, dollars.id, food.id, 500, "2026-03-03");

    await callerFor(user).budgets.save({
      categoryId: food.id,
      currencyId: CURRENCY.UAH,
      amount: 10000,
    });

    const [budget] = await callerFor(user).budgets.list();

    expect(budget).toMatchObject({ amount: 10000, spent: 5000 });
  });

  it("saving the same category and currency again changes the limit", async () => {
    const user = await createUser();
    const food = await makeCategory(user);
    const input = { categoryId: food.id, currencyId: CURRENCY.UAH };

    await callerFor(user).budgets.save({ ...input, amount: 1000 });
    await callerFor(user).budgets.save({ ...input, amount: 2500 });

    const list = await callerFor(user).budgets.list();

    expect(list).toHaveLength(1);
    expect(list[0]?.amount).toBe(2500);
  });

  it("deletes, and only the owner's", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const food = await makeCategory(owner);
    const { id } = await callerFor(owner).budgets.save({
      categoryId: food.id,
      currencyId: CURRENCY.UAH,
      amount: 1000,
    });

    await expectTRPCError(
      callerFor(stranger).budgets.delete({ id }),
      "NOT_FOUND",
    );
    await callerFor(owner).budgets.delete({ id });

    await expect(callerFor(owner).budgets.list()).resolves.toEqual([]);
  });

  it("refuses income-only and unreadable categories", async () => {
    const user = await createUser();
    const stranger = await createUser();
    const salary = await makeCategory(user, {
      isExpense: false,
      isIncome: true,
    });
    const theirs = await makeCategory(stranger);

    await expectTRPCError(
      callerFor(user).budgets.save({
        categoryId: salary.id,
        currencyId: CURRENCY.UAH,
        amount: 1000,
      }),
      "BAD_REQUEST",
      "fields_integrity_not_expense_category",
    );
    await expectTRPCError(
      callerFor(user).budgets.save({
        categoryId: theirs.id,
        currencyId: CURRENCY.UAH,
        amount: 1000,
      }),
      "FORBIDDEN",
    );
  });
});

describe("dashboard.month", () => {
  it("compares this month with the same days of last month", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const food = await makeCategory(user);

    await spend(user, account.id, food.id, 1000, "2026-03-05");
    await spend(user, account.id, food.id, 4000, "2026-02-10");
    // after the 15th of last month: outside the compared days
    await spend(user, account.id, food.id, 7000, "2026-02-20");

    const month = await callerFor(user).dashboard.month();

    expect(month.days).toBe(15);
    expect(month.current[0]?.expenses).toBe(-1000);
    expect(month.previous[0]?.expenses).toBe(-4000);
  });
});
