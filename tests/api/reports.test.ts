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
