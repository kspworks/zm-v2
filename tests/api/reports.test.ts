import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import { reportRows } from "~/server/services/transaction-queries";
import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import { createUser, makeAccount, makeCategory } from "../helpers/fixtures";

const range = {
  accounts: [],
  categories: [],
  counterparties: [],
  startDate: "2026-03-01",
  endDate: "2026-03-31",
};

describe("reports.data", () => {
  it("returns submitted rows in range, without own-account transfers", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);
    const food = await makeCategory(user, { name: "Food" });
    const c = callerFor(user);

    await c.transactions.create({
      kind: "expense",
      date: "2026-03-05",
      amount: 100,
      accountId: a.id,
      categoryId: food.id,
    });
    await c.transactions.create({
      kind: "expense",
      date: "2026-04-05",
      amount: 999,
      accountId: a.id,
    });
    await c.transactions.create({
      kind: "transfer",
      date: "2026-03-05",
      amount: 50,
      accountId: a.id,
      linkedAccountId: b.id,
      linkedAmount: 50,
    });
    await c.transactions.create({
      kind: "debt",
      date: "2026-03-06",
      amount: 30,
      accountId: a.id,
      direction: "took",
      counterparty: { name: "Alex" },
    });

    const result = await c.reports.data({ filter: range });

    expect(result.truncated).toBe(false);
    // both rows sit on the real account, the debt's counterparty is exposed
    expect(result.rows.map((r) => r.accountId)).toEqual([a.id, a.id]);
    expect(result.rows[1]?.counterpartyId).toEqual(expect.any(String));
    expect(
      result.rows.map((r) => [
        r.kind,
        r.amount,
        r.categoryName,
        r.counterpartyName,
        r.debtLabel?.parts ?? null,
      ]),
    ).toEqual([
      ["expense", -100, "Food", null, null],
      // the debt counts by its real-account leg
      ["debt", 30, null, "Alex", [{ kind: "borrowed", amount: 30 }]],
    ]);
  });

  it("labels debts against the counterparty's history before the range", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const c = callerFor(user);

    await c.transactions.create({
      kind: "debt",
      date: "2026-02-10",
      amount: 500,
      accountId: account.id,
      direction: "gave",
      counterparty: { name: "Alex" },
    });
    await c.transactions.create({
      kind: "debt",
      date: "2026-03-10",
      amount: 300,
      accountId: account.id,
      direction: "took",
      counterparty: { name: "Alex" },
    });

    const result = await c.reports.data({ filter: range });

    expect(result.rows.map((r) => [r.amount, r.debtLabel])).toEqual([
      [300, { parts: [{ kind: "repaidToMe", amount: 300 }], settles: false }],
    ]);
  });

  it("requires the date range", async () => {
    const user = await createUser();

    await expectTRPCError(
      callerFor(user).reports.data({
        // @ts-expect-error: both dates are required
        filter: { accounts: [], categories: [], counterparties: [] },
      }),
      "BAD_REQUEST",
    );
  });

  it("reports truncation instead of silently cutting the period", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    for (let i = 0; i < 3; i++) {
      await callerFor(user).transactions.create({
        kind: "expense",
        date: "2026-03-05",
        amount: 1,
        accountId: account.id,
      });
    }

    const capped = await reportRows(db, user.id, range, 2);
    expect(capped.rows).toHaveLength(2);
    expect(capped.truncated).toBe(true);

    expect((await reportRows(db, user.id, range, 3)).truncated).toBe(false);
  });
});

describe("reports.compare", () => {
  const noFilter = { accounts: [], categories: [], counterparties: [] };
  const march = { startDate: "2026-03-01", endDate: "2026-03-31" };
  const april = { startDate: "2026-04-01", endDate: "2026-04-30" };

  it("totals each period per category, counted like the report", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);
    const food = await makeCategory(user, { name: "Food" });
    const cafe = await makeCategory(user, {
      name: "Cafés",
      parentId: food.id,
    });
    const salary = await makeCategory(user, {
      name: "Salary",
      isExpense: false,
      isIncome: true,
    });
    const c = callerFor(user);

    for (const [date, amount, categoryId] of [
      ["2026-03-05", 100, food.id],
      ["2026-03-06", 40, cafe.id],
      ["2026-04-05", 70, cafe.id],
    ] as const) {
      await c.transactions.create({
        kind: "expense",
        date,
        amount,
        accountId: a.id,
        categoryId,
      });
    }
    await c.transactions.create({
      kind: "income",
      date: "2026-04-01",
      amount: 1000,
      accountId: b.id,
      categoryId: salary.id,
    });
    // an own transfer nets to zero and is left out
    await c.transactions.create({
      kind: "transfer",
      date: "2026-03-07",
      amount: 50,
      accountId: a.id,
      linkedAccountId: b.id,
      linkedAmount: 50,
    });
    // a debt counts by its real-account leg
    await c.transactions.create({
      kind: "debt",
      date: "2026-04-08",
      amount: 30,
      accountId: a.id,
      direction: "gave",
      counterparty: { name: "Alex" },
    });

    const result = await c.reports.compare({
      filter: noFilter,
      periods: [march, april],
    });
    const shape = (rows: typeof result.a) =>
      rows
        .map((r) => [
          r.isDebt,
          r.categoryName,
          r.parentName,
          r.incomes,
          r.expenses,
        ])
        .sort((x, y) => String(x[1]).localeCompare(String(y[1])));

    expect(shape(result.a)).toEqual([
      [false, "Cafés", "Food", 0, -40],
      [false, "Food", null, 0, -100],
    ]);
    expect(shape(result.b)).toEqual([
      [false, "Cafés", "Food", 0, -70],
      [true, null, null, 0, -30],
      [false, "Salary", null, 1000, 0],
    ]);

    // the account filter applies to both periods
    const onlyB = await c.reports.compare({
      filter: { ...noFilter, accounts: [b.id] },
      periods: [march, april],
    });
    expect(onlyB.a).toEqual([]);
    expect(onlyB.b.map((r) => r.incomes)).toEqual([1000]);
  });

  it("leaves out accounts the user can't read", async () => {
    const owner = await createUser();
    const other = await createUser();
    const account = await makeAccount(owner);

    await callerFor(owner).transactions.create({
      kind: "expense",
      date: "2026-03-05",
      amount: 100,
      accountId: account.id,
    });

    const result = await callerFor(other).reports.compare({
      filter: noFilter,
      periods: [march, april],
    });

    expect(result).toEqual({ a: [], b: [] });
  });

  it("rejects a reversed period", async () => {
    const user = await createUser();
    const error = await expectTRPCError(
      callerFor(user).reports.compare({
        filter: noFilter,
        periods: [march, { startDate: "2026-04-30", endDate: "2026-04-01" }],
      }),
      "BAD_REQUEST",
    );

    expect(JSON.stringify(error.cause)).toContain("start_date_lte_end_date");
  });
});
