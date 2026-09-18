import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import { categories, transactions } from "~/server/db/schema";
import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import {
  createUser,
  grant,
  makeAccount,
  makeCategory,
  type TestUser,
} from "../helpers/fixtures";

const balanceOf = async (user: TestUser, id: string) =>
  (await callerFor(user).accounts.list()).find((a) => a.id === id)?.balance;

describe("transactions.bulkCreate", () => {
  it("inserts every row in one call", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const food = await makeCategory(user);

    const result = await callerFor(user).transactions.bulkCreate({
      items: [
        {
          kind: "expense",
          date: "2026-03-01",
          amount: 100,
          accountId: account.id,
          categoryId: food.id,
        },
        {
          kind: "expense",
          date: "2026-03-01",
          amount: 250,
          accountId: account.id,
          comment: "x",
        },
        {
          kind: "income",
          date: "2026-03-01",
          amount: 1000,
          accountId: account.id,
        },
      ],
    });

    expect(result.created).toBe(3);
    expect(result.balances).toEqual([
      { id: account.id, name: account.name, balance: 650 },
    ]);
    expect(await db.select().from(transactions)).toHaveLength(3);
  });

  it("is all or nothing", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const incomeOnly = await makeCategory(user, {
      isExpense: false,
      isIncome: true,
    });

    await expectTRPCError(
      callerFor(user).transactions.bulkCreate({
        items: [
          {
            kind: "expense",
            date: "2026-03-01",
            amount: 100,
            accountId: account.id,
          },
          {
            kind: "expense",
            date: "2026-03-01",
            amount: 100,
            accountId: account.id,
            categoryId: incomeOnly.id,
          },
        ],
      }),
      "BAD_REQUEST",
      "fields_integrity_not_expense_category",
    );

    expect(await db.select().from(transactions)).toEqual([]);
  });

  it("checks permissions on every row", async () => {
    const owner = await createUser();
    const user = await createUser();
    const mine = await makeAccount(user);
    const readOnly = await makeAccount(owner);
    await grant("account", readOnly.id, user);

    await expectTRPCError(
      callerFor(user).transactions.bulkCreate({
        items: [
          {
            kind: "expense",
            date: "2026-03-01",
            amount: 1,
            accountId: mine.id,
          },
          {
            kind: "expense",
            date: "2026-03-01",
            amount: 1,
            accountId: readOnly.id,
          },
        ],
      }),
      "FORBIDDEN",
    );
    expect(await db.select().from(transactions)).toEqual([]);
  });

  it("refuses an empty list", async () => {
    const user = await createUser();

    await expectTRPCError(
      callerFor(user).transactions.bulkCreate({ items: [] }),
      "BAD_REQUEST",
    );
  });
});

describe("transactions.adjustBalance", () => {
  it("records a negative difference as an expense in the Adjustment category", async () => {
    const user = await createUser({ locale: "en" });
    const account = await makeAccount(user, { initialBalance: 10_000 });
    const adjustment = await makeCategory(user, {
      name: "Adjustment",
      seedKey: "adjustment",
      isExpense: true,
      isIncome: true,
    });

    const result = await callerFor(user).transactions.adjustBalance({
      accountId: account.id,
      actualBalance: 7_550,
    });

    expect(result).toMatchObject({ created: true, difference: -2_450 });
    const [row] = await db.select().from(transactions);
    expect(row).toMatchObject({
      kind: "expense",
      amount: -2_450,
      categoryId: adjustment.id,
      comment: "Balance adjustment",
    });
    expect(await balanceOf(user, account.id)).toBe(7_550);
  });

  it("records a positive difference as income, comment in the user's locale", async () => {
    const user = await createUser({ locale: "uk" });
    const account = await makeAccount(user);
    await makeCategory(user, {
      seedKey: "adjustment",
      isExpense: true,
      isIncome: true,
    });

    await callerFor(user).transactions.adjustBalance({
      accountId: account.id,
      actualBalance: 300,
    });

    const [row] = await db.select().from(transactions);
    expect(row).toMatchObject({
      kind: "income",
      amount: 300,
      comment: "Коригування балансу",
    });
  });

  it("uses no category when the seeded one was deleted", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const adjustment = await makeCategory(user, {
      seedKey: "adjustment",
      isExpense: true,
      isIncome: true,
    });
    await db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(eq(categories.id, adjustment.id));

    await callerFor(user).transactions.adjustBalance({
      accountId: account.id,
      actualBalance: -100,
    });

    const [row] = await db.select().from(transactions);
    expect(row?.categoryId).toBeNull();
  });

  it("creates nothing for a zero difference", async () => {
    const user = await createUser();
    const account = await makeAccount(user, { initialBalance: 500 });

    expect(
      await callerFor(user).transactions.adjustBalance({
        accountId: account.id,
        actualBalance: 500,
      }),
    ).toEqual({ created: false, difference: 0 });
    expect(await db.select().from(transactions)).toEqual([]);
  });

  it("needs write access", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, reader);

    await expectTRPCError(
      callerFor(reader).transactions.adjustBalance({
        accountId: account.id,
        actualBalance: 1,
      }),
      "FORBIDDEN",
    );
  });

  it("serialises concurrent adjustments", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    await Promise.all(
      Array.from({ length: 4 }, () =>
        callerFor(user).transactions.adjustBalance({
          accountId: account.id,
          actualBalance: 1_000,
        }),
      ),
    );

    expect(await balanceOf(user, account.id)).toBe(1_000);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });
});
