import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { TransactionInputData as TransactionInput } from "~/lib/validators/transactions";
import { db } from "~/server/db";
import {
  accounts,
  counterparties,
  historyLogs,
  transactions,
} from "~/server/db/schema";
import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import {
  CURRENCY,
  createUser,
  grant,
  insertTransactionRow,
  makeAccount,
  makeCategory,
  type TestUser,
} from "../helpers/fixtures";

const DATE = "2026-03-10";

const rowsOf = (ids: string[]) =>
  db.select().from(transactions).where(inArray(transactions.id, ids));

const balanceOf = async (user: TestUser, accountId: string) => {
  const list = await callerFor(user).accounts.list();

  return list.find((row) => row.id === accountId)?.balance;
};

const debtAccountOf = async (userId: string, currencyId: string) =>
  db.query.accounts.findFirst({
    where: and(
      eq(accounts.createdBy, userId),
      eq(accounts.currencyId, currencyId),
      eq(accounts.type, "debt"),
    ),
  });

const expense = (
  accountId: string,
  extra: Partial<Extract<TransactionInput, { kind: "expense" }>> = {},
): TransactionInput => ({
  kind: "expense",
  date: DATE,
  amount: 1000,
  accountId,
  comment: null,
  ...extra,
});

describe("expense and income", () => {
  it("stores an expense as one negative row", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const category = await makeCategory(user);

    const result = await callerFor(user).transactions.create(
      expense(account.id, { categoryId: category.id, comment: "  bread " }),
    );

    expect(result.batchId).toBeNull();
    const [row] = await rowsOf(result.ids);
    expect(row).toMatchObject({
      kind: "expense",
      amount: -1000,
      accountId: account.id,
      categoryId: category.id,
      comment: "bread",
      date: DATE,
      isPlanned: false,
      createdBy: user.id,
    });
  });

  it("stores an income as one positive row", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const salary = await makeCategory(user, {
      isExpense: false,
      isIncome: true,
    });

    const result = await callerFor(user).transactions.create({
      kind: "income",
      date: DATE,
      amount: 5000,
      accountId: account.id,
      categoryId: salary.id,
      comment: "",
    });

    const [row] = await rowsOf(result.ids);
    expect(row).toMatchObject({ kind: "income", amount: 5000, comment: null });
  });

  it("checks the category kind", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const incomeOnly = await makeCategory(user, {
      isExpense: false,
      isIncome: true,
    });
    const expenseOnly = await makeCategory(user);

    await expectTRPCError(
      callerFor(user).transactions.create(
        expense(account.id, { categoryId: incomeOnly.id }),
      ),
      "BAD_REQUEST",
      "fields_integrity_not_expense_category",
    );
    await expectTRPCError(
      callerFor(user).transactions.create({
        kind: "income",
        date: DATE,
        amount: 1,
        accountId: account.id,
        categoryId: expenseOnly.id,
      }),
      "BAD_REQUEST",
      "fields_integrity_not_income_category",
    );
  });

  it("allows no category", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const result = await callerFor(user).transactions.create(
      expense(account.id),
    );

    const [row] = await rowsOf(result.ids);
    expect(row?.categoryId).toBeNull();
  });

  it("creates or matches the optional counterparty", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    const first = await callerFor(user).transactions.create(
      expense(account.id, { counterparty: { name: "Silpo" } }),
    );
    const second = await callerFor(user).transactions.create(
      expense(account.id, { counterparty: { name: "silpo " } }),
    );

    const rows = await rowsOf([...first.ids, ...second.ids]);
    expect(new Set(rows.map((row) => row.counterpartyId)).size).toBe(1);
    expect(
      await db
        .select()
        .from(counterparties)
        .where(eq(counterparties.ownerId, user.id)),
    ).toHaveLength(1);
  });

  it("rejects a zero or oversized amount", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    await expectTRPCError(
      callerFor(user).transactions.create(expense(account.id, { amount: 0 })),
      "BAD_REQUEST",
    );
    await expectTRPCError(
      callerFor(user).transactions.create(
        expense(account.id, { amount: 100_000_000_000 }),
      ),
      "BAD_REQUEST",
    );
  });

  it("rejects a comment over 500 chars", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    await expectTRPCError(
      callerFor(user).transactions.create(
        expense(account.id, { comment: "x".repeat(501) }),
      ),
      "BAD_REQUEST",
    );
  });

  it("writes an audit row in the same transaction", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const result = await callerFor(user).transactions.create(
      expense(account.id),
    );

    const logs = await db
      .select()
      .from(historyLogs)
      .where(eq(historyLogs.entityType, "transaction"));
    expect(logs).toMatchObject([
      { entityId: result.ids[0], action: "create", userId: user.id },
    ]);
  });
});

describe("transfer", () => {
  it("stores two legs with one batch, amounts may differ", async () => {
    const user = await createUser();
    const uah = await makeAccount(user, { currencyId: CURRENCY.UAH });
    const usd = await makeAccount(user, { currencyId: CURRENCY.USD });

    const result = await callerFor(user).transactions.create({
      kind: "transfer",
      date: DATE,
      amount: 41_000,
      accountId: uah.id,
      linkedAccountId: usd.id,
      linkedAmount: 1_000,
      comment: "exchange",
    });

    expect(result.batchId).toBeTruthy();
    const rows = await rowsOf(result.ids);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.batchId === result.batchId)).toBe(true);
    expect(rows.every((row) => row.kind === "transfer")).toBe(true);
    expect(rows.find((row) => row.accountId === uah.id)?.amount).toBe(-41_000);
    expect(rows.find((row) => row.accountId === usd.id)?.amount).toBe(1_000);
    expect(rows.every((row) => row.comment === "exchange")).toBe(true);
    expect(rows.every((row) => row.categoryId === null)).toBe(true);
  });

  it("refuses the same account on both sides", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    await expectTRPCError(
      callerFor(user).transactions.create({
        kind: "transfer",
        date: DATE,
        amount: 1,
        accountId: account.id,
        linkedAccountId: account.id,
        linkedAmount: 1,
      }),
      "BAD_REQUEST",
      "fields_integrity_same_account_transfer",
    );
  });

  it("needs write access to the linked account", async () => {
    const user = await createUser();
    const owner = await createUser();
    const mine = await makeAccount(user);
    const shared = await makeAccount(owner);
    await grant("account", shared.id, user);

    await expectTRPCError(
      callerFor(user).transactions.create({
        kind: "transfer",
        date: DATE,
        amount: 1,
        accountId: mine.id,
        linkedAccountId: shared.id,
        linkedAmount: 1,
      }),
      "FORBIDDEN",
    );
  });
});

describe("debt", () => {
  const debt = (
    accountId: string,
    direction: "gave" | "took",
    amount = 500,
    name = "Alex",
  ): TransactionInput => ({
    kind: "debt",
    date: DATE,
    amount,
    accountId,
    direction,
    counterparty: { name },
    comment: "loan",
  });

  it("'I gave' puts -X on my account and +X on my debt account", async () => {
    const user = await createUser({ locale: "en" });
    const cash = await makeAccount(user, { currencyId: CURRENCY.UAH });

    const result = await callerFor(user).transactions.create(
      debt(cash.id, "gave"),
    );

    const debtAccount = await debtAccountOf(user.id, CURRENCY.UAH);
    expect(debtAccount).toMatchObject({ name: "Debts", type: "debt" });

    const rows = await rowsOf(result.ids);
    expect(rows.find((row) => row.accountId === cash.id)?.amount).toBe(-500);
    expect(rows.find((row) => row.accountId === debtAccount?.id)?.amount).toBe(
      500,
    );
    expect(rows.every((row) => row.kind === "debt")).toBe(true);
    expect(new Set(rows.map((row) => row.counterpartyId)).size).toBe(1);
    expect(rows.every((row) => row.comment === "loan")).toBe(true);
  });

  it("'I took' puts +X on my account and -X on the debt account", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);

    const result = await callerFor(user).transactions.create(
      debt(cash.id, "took"),
    );

    const rows = await rowsOf(result.ids);
    expect(rows.find((row) => row.accountId === cash.id)?.amount).toBe(500);
    expect(rows.find((row) => row.accountId !== cash.id)?.amount).toBe(-500);
  });

  it("uses one debt account per currency and per user", async () => {
    const user = await createUser();
    const other = await createUser();
    const uah = await makeAccount(user, { currencyId: CURRENCY.UAH });
    const uah2 = await makeAccount(user, { currencyId: CURRENCY.UAH });
    const eur = await makeAccount(user, { currencyId: CURRENCY.EUR });
    const otherUah = await makeAccount(other, { currencyId: CURRENCY.UAH });

    await callerFor(user).transactions.create(debt(uah.id, "gave"));
    await callerFor(user).transactions.create(debt(uah2.id, "took"));
    await callerFor(user).transactions.create(debt(eur.id, "gave"));
    await callerFor(other).transactions.create(debt(otherUah.id, "gave"));

    const debtAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.type, "debt"));

    expect(debtAccounts.map((a) => [a.createdBy, a.currencyId]).sort()).toEqual(
      [
        [user.id, CURRENCY.UAH],
        [user.id, CURRENCY.EUR],
        [other.id, CURRENCY.UAH],
      ].sort(),
    );
  });

  it("requires a counterparty", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);

    await expectTRPCError(
      callerFor(user).transactions.create({
        kind: "debt",
        date: DATE,
        amount: 1,
        accountId: cash.id,
        direction: "gave",
        // @ts-expect-error: the counterparty is required
        counterparty: undefined,
      }),
      "BAD_REQUEST",
    );
    await expectTRPCError(
      callerFor(user).transactions.create({
        kind: "debt",
        date: DATE,
        amount: 1,
        accountId: cash.id,
        direction: "gave",
        counterparty: { name: "   " },
      }),
      "BAD_REQUEST",
    );
  });

  it("never lets a debt account be picked directly", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);
    await callerFor(user).transactions.create(debt(cash.id, "gave"));
    const debtAccount = await debtAccountOf(user.id, CURRENCY.UAH);

    await expectTRPCError(
      callerFor(user).transactions.create(expense(debtAccount?.id ?? "")),
      "FORBIDDEN",
      "account_is_debt",
    );
  });

  it("hides the debt account from the accounts list", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);
    await callerFor(user).transactions.create(debt(cash.id, "gave"));

    const list = await callerFor(user).accounts.list();
    expect(list.map((row) => row.id)).toEqual([cash.id]);
  });
});

describe("create permissions", () => {
  it("needs write access to the account", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, reader);

    await expectTRPCError(
      callerFor(reader).transactions.create(expense(account.id)),
      "FORBIDDEN",
    );
    await expectTRPCError(
      callerFor(await createUser()).transactions.create(expense(account.id)),
      "FORBIDDEN",
    );
  });

  it("lets a read+write member create", async () => {
    const owner = await createUser();
    const writer = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, writer, { canWrite: true });

    await expect(
      callerFor(writer).transactions.create(expense(account.id)),
    ).resolves.toBeTruthy();
  });

  it("needs write access to the category", async () => {
    const owner = await createUser();
    const user = await createUser();
    const account = await makeAccount(user);
    const category = await makeCategory(owner);
    await grant("category", category.id, user);

    await expectTRPCError(
      callerFor(user).transactions.create(
        expense(account.id, { categoryId: category.id }),
      ),
      "FORBIDDEN",
    );
  });

  it("refuses unknown and deleted accounts", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await callerFor(user).accounts.delete({ id: account.id });

    await expectTRPCError(
      callerFor(user).transactions.create(expense(account.id)),
      "FORBIDDEN",
    );
    await expectTRPCError(
      callerFor(user).transactions.create(expense("missing")),
      "FORBIDDEN",
    );
  });

  it("returns the balances so the client can warn about a negative one", async () => {
    const user = await createUser();
    const account = await makeAccount(user, {
      name: "Card",
      initialBalance: 500,
    });

    const result = await callerFor(user).transactions.create(
      expense(account.id, { amount: 800 }),
    );

    expect(result.balances).toEqual([
      { id: account.id, name: "Card", balance: -300 },
    ]);
  });
});

describe("transactions.update", () => {
  it("cannot change the kind", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const { ids } = await callerFor(user).transactions.create(
      expense(account.id),
    );

    await expectTRPCError(
      callerFor(user).transactions.update({
        id: ids[0] ?? "",
        data: {
          kind: "income",
          date: DATE,
          amount: 1,
          accountId: account.id,
        },
      }),
      "BAD_REQUEST",
      "type_change_not_supported",
    );
  });

  it("moves an expense to another account and updates both balances", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);
    const { ids } = await callerFor(user).transactions.create(expense(a.id));

    await callerFor(user).transactions.update({
      id: ids[0] ?? "",
      data: expense(b.id, { amount: 250 }),
    });

    expect(await balanceOf(user, a.id)).toBe(0);
    expect(await balanceOf(user, b.id)).toBe(-250);
  });

  it("updates both legs of a transfer, swapping either side", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);
    const c = await makeAccount(user);
    const created = await callerFor(user).transactions.create({
      kind: "transfer",
      date: DATE,
      amount: 100,
      accountId: a.id,
      linkedAccountId: b.id,
      linkedAmount: 100,
    });

    // swap the destination, editing through the destination leg's id
    const destination = (await rowsOf(created.ids)).find(
      (row) => row.amount > 0,
    );
    await callerFor(user).transactions.update({
      id: destination?.id ?? "",
      data: {
        kind: "transfer",
        date: DATE,
        amount: 300,
        accountId: a.id,
        linkedAccountId: c.id,
        linkedAmount: 290,
      },
    });

    expect(await balanceOf(user, a.id)).toBe(-300);
    expect(await balanceOf(user, b.id)).toBe(0);
    expect(await balanceOf(user, c.id)).toBe(290);

    // now swap the source
    await callerFor(user).transactions.update({
      id: created.ids[0] ?? "",
      data: {
        kind: "transfer",
        date: DATE,
        amount: 300,
        accountId: b.id,
        linkedAccountId: c.id,
        linkedAmount: 290,
      },
    });

    expect(await balanceOf(user, a.id)).toBe(0);
    expect(await balanceOf(user, b.id)).toBe(-300);
    expect(await balanceOf(user, c.id)).toBe(290);

    const rows = await rowsOf(created.ids);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.batchId)).size).toBe(1);
  });

  it("re-resolves the debt account when the account's currency changes", async () => {
    const user = await createUser();
    const uah = await makeAccount(user, { currencyId: CURRENCY.UAH });
    const usd = await makeAccount(user, { currencyId: CURRENCY.USD });
    const created = await callerFor(user).transactions.create({
      kind: "debt",
      date: DATE,
      amount: 500,
      accountId: uah.id,
      direction: "gave",
      counterparty: { name: "Alex" },
    });

    await callerFor(user).transactions.update({
      id: created.ids[0] ?? "",
      data: {
        kind: "debt",
        date: DATE,
        amount: 700,
        accountId: usd.id,
        direction: "took",
        counterparty: { name: "Alex" },
      },
    });

    const usdDebt = await debtAccountOf(user.id, CURRENCY.USD);
    const rows = await rowsOf(created.ids);

    expect(rows.find((row) => row.accountId === usd.id)?.amount).toBe(700);
    expect(rows.find((row) => row.accountId === usdDebt?.id)?.amount).toBe(
      -700,
    );
    expect(await balanceOf(user, uah.id)).toBe(0);
  });

  it("needs delete rights on the old values and create rights on the new", async () => {
    const owner = await createUser();
    const user = await createUser();
    const readOnly = await makeAccount(owner);
    const mine = await makeAccount(user);
    await grant("account", readOnly.id, user);

    const onReadOnly = await insertTransactionRow({
      accountId: readOnly.id,
      amount: -100,
      createdBy: owner.id,
    });

    // can't take it away from a read-only account
    await expectTRPCError(
      callerFor(user).transactions.update({
        id: onReadOnly.id,
        data: expense(mine.id),
      }),
      "FORBIDDEN",
    );

    // can't move own transaction onto a read-only account
    const { ids } = await callerFor(user).transactions.create(expense(mine.id));
    await expectTRPCError(
      callerFor(user).transactions.update({
        id: ids[0] ?? "",
        data: expense(readOnly.id),
      }),
      "FORBIDDEN",
    );
  });

  it("submits a planned occurrence: isPlanned false, createdAt now", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const planned = await insertTransactionRow({
      accountId: account.id,
      amount: -100,
      isPlanned: true,
      createdAt: new Date("2025-01-01T00:00:00Z"),
      createdBy: user.id,
    });

    expect(await balanceOf(user, account.id)).toBe(0);

    const before = Date.now();
    const result = await callerFor(user).transactions.update({
      id: planned.id,
      data: expense(account.id, { amount: 120 }),
    });

    expect(result.submitted).toBe(true);
    const [row] = await rowsOf([planned.id]);
    expect(row?.isPlanned).toBe(false);
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await balanceOf(user, account.id)).toBe(-120);
  });

  it("returns NOT_FOUND for a deleted row", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const { ids } = await callerFor(user).transactions.create(
      expense(account.id),
    );
    await callerFor(user).transactions.delete({ id: ids[0] ?? "" });

    await expectTRPCError(
      callerFor(user).transactions.update({
        id: ids[0] ?? "",
        data: expense(account.id),
      }),
      "NOT_FOUND",
    );
  });
});

describe("transactions.delete", () => {
  it("soft-deletes every leg of the batch and restores the balances", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);
    const created = await callerFor(user).transactions.create({
      kind: "transfer",
      date: DATE,
      amount: 100,
      accountId: a.id,
      linkedAccountId: b.id,
      linkedAmount: 100,
    });

    // delete through either leg
    await callerFor(user).transactions.delete({ id: created.ids[1] ?? "" });

    const rows = await rowsOf(created.ids);
    expect(rows.every((row) => row.deletedAt !== null)).toBe(true);
    expect(await balanceOf(user, a.id)).toBe(0);
    expect(await balanceOf(user, b.id)).toBe(0);

    const logs = await db
      .select()
      .from(historyLogs)
      .where(eq(historyLogs.action, "delete"));
    expect(logs).toHaveLength(2);
  });

  it("needs write access to the account, category and the linked leg", async () => {
    const owner = await createUser();
    const user = await createUser();
    const mine = await makeAccount(user);
    const theirs = await makeAccount(owner);
    await grant("account", theirs.id, user);

    const batchId = "batch-1";
    const leg = await insertTransactionRow({
      kind: "transfer",
      batchId,
      accountId: mine.id,
      amount: -100,
      createdBy: owner.id,
    });
    await insertTransactionRow({
      kind: "transfer",
      batchId,
      accountId: theirs.id,
      amount: 100,
      createdBy: owner.id,
    });

    await expectTRPCError(
      callerFor(user).transactions.delete({ id: leg.id }),
      "FORBIDDEN",
    );

    const category = await makeCategory(owner);
    await grant("category", category.id, user);
    const categorized = await insertTransactionRow({
      accountId: mine.id,
      categoryId: category.id,
      amount: -1,
      createdBy: user.id,
    });

    await expectTRPCError(
      callerFor(user).transactions.delete({ id: categorized.id }),
      "FORBIDDEN",
    );
  });
});
