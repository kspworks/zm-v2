import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TransactionInputData as TransactionInput } from "~/lib/validators/transactions";
import { db } from "~/server/db";
import { transactions } from "~/server/db/schema";
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

const noFilter = { accounts: [], categories: [], counterparties: [] };

const expense = (
  accountId: string,
  amount: number,
  extra: Partial<Extract<TransactionInput, { kind: "expense" }>> = {},
): TransactionInput => ({
  kind: "expense",
  date: "2026-03-10",
  amount,
  accountId,
  ...extra,
});

const list = (user: TestUser, filter: Record<string, unknown> = {}) =>
  callerFor(user).transactions.list({ filter: { ...noFilter, ...filter } });

const idsOf = (result: { items: { id: string }[] }) =>
  result.items.map((item) => item.id);

describe("transactions.list", () => {
  it("returns submitted rows newest first, created order breaking ties", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const c = callerFor(user);

    const old = await c.transactions.create(
      expense(account.id, 1, { date: "2026-01-01" }),
    );
    const first = await c.transactions.create(
      expense(account.id, 2, { date: "2026-02-01" }),
    );
    const second = await c.transactions.create(
      expense(account.id, 3, { date: "2026-02-01" }),
    );

    // TRANSACTIONS_PAGINATION_LIMIT is 3 in .env.test
    expect(idsOf(await list(user))).toEqual([
      second.ids[0],
      first.ids[0],
      old.ids[0],
    ]);
  });

  it("shows a pair once, with the negative leg primary and the other linked", async () => {
    const user = await createUser();
    const a = await makeAccount(user, { name: "A" });
    const b = await makeAccount(user, { name: "B", currencyId: CURRENCY.USD });

    await callerFor(user).transactions.create({
      kind: "transfer",
      date: "2026-03-10",
      amount: 4100,
      accountId: a.id,
      linkedAccountId: b.id,
      linkedAmount: 100,
    });

    const { items } = await list(user);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "transfer",
      amount: -4100,
      account: { id: a.id, name: "A", currencyCode: "UAH" },
      linked: {
        amount: 100,
        account: {
          id: b.id,
          name: "B",
          currencyCode: "USD",
          currencySign: "$",
        },
      },
    });
  });

  it("excludes planned and deleted rows", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await insertTransactionRow({
      accountId: account.id,
      amount: -1,
      isPlanned: true,
      createdBy: user.id,
    });
    await insertTransactionRow({
      accountId: account.id,
      amount: -1,
      deletedAt: new Date(),
      createdBy: user.id,
    });

    expect((await list(user)).items).toEqual([]);
  });

  it("shows rows of readable accounts only, including shared ones", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const stranger = await createUser();
    const shared = await makeAccount(owner);
    await grant("account", shared.id, reader);
    await callerFor(owner).transactions.create(expense(shared.id, 5));

    expect((await list(reader)).items).toHaveLength(1);
    expect((await list(stranger)).items).toHaveLength(0);
  });

  it("shows a transfer when either leg is readable", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const a = await makeAccount(owner);
    const b = await makeAccount(owner);
    await grant("account", b.id, reader);
    await callerFor(owner).transactions.create({
      kind: "transfer",
      date: "2026-03-10",
      amount: 10,
      accountId: a.id,
      linkedAccountId: b.id,
      linkedAmount: 10,
    });

    expect((await list(reader)).items).toHaveLength(1);
  });

  it("labels a deleted category", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const parent = await makeCategory(user, { name: "Home" });
    const child = await makeCategory(user, {
      name: "Repair",
      parentId: parent.id,
    });
    await callerFor(user).transactions.create(
      expense(account.id, 5, { categoryId: child.id }),
    );

    let [row] = (await list(user)).items;
    expect(row?.category).toMatchObject({
      name: "Repair",
      parentName: "Home",
      deleted: false,
    });

    await callerFor(user).categories.delete({ id: child.id });
    [row] = (await list(user)).items;
    expect(row?.category?.deleted).toBe(true);
  });
});

describe("filters", () => {
  const setup = async () => {
    const user = await createUser();
    const a = await makeAccount(user, { name: "A" });
    const b = await makeAccount(user, { name: "B" });
    const food = await makeCategory(user, { name: "Food" });
    const c = callerFor(user);

    const plain = await c.transactions.create(
      expense(a.id, 10_050, {
        date: "2026-01-10",
        categoryId: food.id,
        comment: "Weekly 50% SALE",
        counterparty: { name: "Silpo" },
      }),
    );
    const uncategorized = await c.transactions.create(
      expense(b.id, 10_099, { date: "2026-02-10", comment: "coffee" }),
    );
    const transfer = await c.transactions.create({
      kind: "transfer",
      date: "2026-03-10",
      amount: 30_000,
      accountId: a.id,
      linkedAccountId: b.id,
      linkedAmount: 10_000,
      comment: "move",
    });

    return {
      user,
      a,
      b,
      food,
      plain: plain.ids[0],
      uncategorized: uncategorized.ids[0],
      transfer: transfer.ids.find(Boolean),
      transferPrimary: async () =>
        (await list(user)).items.find((item) => item.kind === "transfer")?.id,
    };
  };

  it("matches accounts on either leg", async () => {
    const s = await setup();
    const transferId = await s.transferPrimary();

    expect(idsOf(await list(s.user, { accounts: [s.b.id] })).sort()).toEqual(
      [s.uncategorized, transferId].sort(),
    );
    expect(idsOf(await list(s.user, { accounts: [s.a.id] })).sort()).toEqual(
      [s.plain, transferId].sort(),
    );
  });

  it("matches categories, and 'null' means non-batched rows without one", async () => {
    const s = await setup();

    expect(idsOf(await list(s.user, { categories: [s.food.id] }))).toEqual([
      s.plain,
    ]);
    expect(idsOf(await list(s.user, { categories: ["null"] }))).toEqual([
      s.uncategorized,
    ]);
    expect(
      idsOf(await list(s.user, { categories: ["null", s.food.id] })).sort(),
    ).toEqual([s.plain, s.uncategorized].sort());
  });

  it("matches an inclusive date range", async () => {
    const s = await setup();

    expect(
      idsOf(
        await list(s.user, { startDate: "2026-01-10", endDate: "2026-02-10" }),
      ).sort(),
    ).toEqual([s.plain, s.uncategorized].sort());
    expect(idsOf(await list(s.user, { startDate: "2026-02-11" }))).toEqual([
      await s.transferPrimary(),
    ]);
  });

  it("rejects start after end, on the offending fields", async () => {
    const s = await setup();
    const error = await expectTRPCError(
      list(s.user, { startDate: "2026-02-01", endDate: "2026-01-01" }),
      "BAD_REQUEST",
    );

    const issues = JSON.stringify(error.cause);
    expect(issues).toContain("start_date_lte_end_date");
    expect(issues).toContain("end_date_gte_start_date");
  });

  it("matches a whole amount to its whole-unit range and a decimal to exact cents", async () => {
    const s = await setup();

    // 100 matches 100.00-100.99: both 100.50 and 100.99, and the 100.00 leg
    expect(idsOf(await list(s.user, { amount: "100" })).sort()).toEqual(
      [s.plain, s.uncategorized, await s.transferPrimary()].sort(),
    );
    expect(idsOf(await list(s.user, { amount: "100.5" }))).toEqual([s.plain]);
    expect(idsOf(await list(s.user, { amount: "100,99" }))).toEqual([
      s.uncategorized,
    ]);
    // the transfer's linked leg is 100.00, its primary leg 300.00
    expect(idsOf(await list(s.user, { amount: "300" }))).toEqual([
      await s.transferPrimary(),
    ]);
    expect(idsOf(await list(s.user, { amount: "101" }))).toEqual([]);
  });

  it("rejects an invalid amount filter", async () => {
    const s = await setup();

    await expectTRPCError(list(s.user, { amount: "1.234" }), "BAD_REQUEST");
  });

  it("matches counterparties", async () => {
    const s = await setup();
    const [row] = (await list(s.user, { amount: "100.5" })).items;

    expect(
      idsOf(
        await list(s.user, { counterparties: [row?.counterparty?.id ?? ""] }),
      ),
    ).toEqual([s.plain]);
  });

  it("matches the comment case-insensitively, as a literal substring", async () => {
    const s = await setup();

    expect(idsOf(await list(s.user, { comment: "sale" }))).toEqual([s.plain]);
    expect(idsOf(await list(s.user, { comment: "50%" }))).toEqual([s.plain]);
    // % and _ are literals, not wildcards
    expect(idsOf(await list(s.user, { comment: "5_%" }))).toEqual([]);
    expect(idsOf(await list(s.user, { comment: "MOVE" }))).toEqual([
      await s.transferPrimary(),
    ]);
  });

  it("matches the comment on the linked leg too", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);
    const batchId = "batch";
    const primary = await insertTransactionRow({
      kind: "transfer",
      batchId,
      accountId: a.id,
      amount: -1,
      createdBy: user.id,
    });
    await insertTransactionRow({
      kind: "transfer",
      batchId,
      accountId: b.id,
      amount: 1,
      comment: "only on the linked leg",
      createdBy: user.id,
    });

    expect(idsOf(await list(user, { comment: "linked" }))).toEqual([
      primary.id,
    ]);
  });
});

describe("pagination", () => {
  it("walks every row exactly once with the cursor", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const created: string[] = [];

    for (let i = 0; i < 8; i++) {
      const { ids } = await callerFor(user).transactions.create(
        expense(account.id, i + 1, {
          date: i < 4 ? "2026-01-01" : "2026-01-02",
        }),
      );
      created.push(ids[0] ?? "");
    }

    const seen: string[] = [];
    let cursor = null;
    let pages = 0;

    do {
      const page: Awaited<ReturnType<typeof list>> = await callerFor(
        user,
      ).transactions.list({ filter: noFilter, cursor });
      seen.push(...idsOf(page));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toEqual([...created].reverse());
  });

  it("has no next cursor when the page isn't full", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await callerFor(user).transactions.create(expense(account.id, 1));

    expect((await list(user)).nextCursor).toBeNull();
  });
});

describe("planned and overdue", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists planned rows oldest first", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const later = await insertTransactionRow({
      accountId: account.id,
      amount: -1,
      isPlanned: true,
      date: "2026-04-01",
      createdBy: user.id,
    });
    const sooner = await insertTransactionRow({
      accountId: account.id,
      amount: -1,
      isPlanned: true,
      date: "2026-03-20",
      createdBy: user.id,
    });

    const result = await callerFor(user).transactions.planned({
      filter: noFilter,
    });

    expect(idsOf(result)).toEqual([sooner.id, later.id]);
  });

  it("marks planned rows due today or earlier as overdue", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const overdue = await insertTransactionRow({
      accountId: account.id,
      amount: -1,
      isPlanned: true,
      date: "2026-03-01",
      createdBy: user.id,
    });
    const dueToday = await insertTransactionRow({
      accountId: account.id,
      amount: -1,
      isPlanned: true,
      date: "2026-03-15",
      createdBy: user.id,
    });
    await insertTransactionRow({
      accountId: account.id,
      amount: -1,
      isPlanned: true,
      date: "2026-03-16",
      createdBy: user.id,
    });

    const rows = await callerFor(user).transactions.overdue({
      filter: noFilter,
    });

    expect(rows.map((row) => row.id)).toEqual([overdue.id, dueToday.id]);
  });

  it("caps the overdue block at 50 rows", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await db.insert(transactions).values(
      Array.from({ length: 55 }, () => ({
        kind: "expense" as const,
        date: "2026-03-01",
        amount: -1,
        accountId: account.id,
        isPlanned: true,
        createdBy: user.id,
      })),
    );

    const rows = await callerFor(user).transactions.overdue({
      filter: noFilter,
    });

    expect(rows).toHaveLength(50);
  });
});

describe("filtered totals", () => {
  it("sums expenses and incomes per currency over the whole filtered set", async () => {
    const user = await createUser();
    const uah = await makeAccount(user, { currencyId: CURRENCY.UAH });
    const usd = await makeAccount(user, { currencyId: CURRENCY.USD });
    const c = callerFor(user);

    // more rows than one page (the limit is 3)
    for (let i = 0; i < 5; i++) {
      await c.transactions.create(expense(uah.id, 100));
    }
    await c.transactions.create({
      kind: "income",
      date: "2026-03-10",
      amount: 1000,
      accountId: uah.id,
    });
    await c.transactions.create(expense(usd.id, 7));

    const totals = await c.transactions.totals({ filter: noFilter });

    expect(totals).toEqual([
      {
        currencyId: CURRENCY.UAH,
        currencyCode: "UAH",
        currencySign: "₴",
        expenses: -500,
        incomes: 1000,
        total: 500,
      },
      {
        currencyId: CURRENCY.USD,
        currencyCode: "USD",
        currencySign: "$",
        expenses: -7,
        incomes: 0,
        total: -7,
      },
    ]);
  });

  it("leaves out transfers between own accounts, keeps debts by their real leg", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);
    const c = callerFor(user);

    await c.transactions.create({
      kind: "transfer",
      date: "2026-03-10",
      amount: 999,
      accountId: a.id,
      linkedAccountId: b.id,
      linkedAmount: 999,
    });
    // gave: the real leg (-300) is primary
    await c.transactions.create({
      kind: "debt",
      date: "2026-03-10",
      amount: 300,
      accountId: a.id,
      direction: "gave",
      counterparty: { name: "Alex" },
    });
    // took: the debt-account leg is primary, the real leg (+200) counts
    await c.transactions.create({
      kind: "debt",
      date: "2026-03-10",
      amount: 200,
      accountId: a.id,
      direction: "took",
      counterparty: { name: "Alex" },
    });

    const [totals] = await c.transactions.totals({ filter: noFilter });

    expect(totals).toMatchObject({ expenses: -300, incomes: 200, total: -100 });
  });

  it("applies the filters and hides zero lines", async () => {
    const user = await createUser();
    const uah = await makeAccount(user);
    const usd = await makeAccount(user, { currencyId: CURRENCY.USD });
    await callerFor(user).transactions.create(expense(uah.id, 5));
    await callerFor(user).transactions.create(expense(usd.id, 5));

    const totals = await callerFor(user).transactions.totals({
      filter: { ...noFilter, accounts: [usd.id] },
    });

    expect(totals.map((row) => row.currencyCode)).toEqual(["USD"]);
  });

  it("sums submitted rows by default and planned rows with planned", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const c = callerFor(user);

    await c.transactions.create(expense(account.id, 100));
    await c.planned.create({
      data: expense(account.id, 40),
      schedule: { repeatType: "none" },
    });
    await c.planned.create({
      data: {
        kind: "income",
        date: "2026-04-01",
        amount: 250,
        accountId: account.id,
      },
      schedule: { repeatType: "none" },
    });

    const [submitted] = await c.transactions.totals({ filter: noFilter });
    const [planned] = await c.transactions.totals({
      filter: noFilter,
      planned: true,
    });

    expect(submitted).toMatchObject({
      expenses: -100,
      incomes: 0,
      total: -100,
    });
    expect(planned).toMatchObject({ expenses: -40, incomes: 250, total: 210 });
  });
});

describe("debt labels", () => {
  const debt = (
    user: TestUser,
    accountId: string,
    direction: "gave" | "took",
    amount: number,
    date: string,
    name = "Alex",
  ) =>
    callerFor(user).transactions.create({
      kind: "debt",
      date,
      amount,
      accountId,
      direction,
      counterparty: { name },
    });

  const labels = async (user: TestUser) =>
    (await list(user)).items
      .slice()
      .reverse()
      .map((item) => [item.direction, item.debtLabel]);

  it("labels lent, repaid and split entries against the running balance", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);

    await debt(user, cash.id, "gave", 500, "2026-01-01"); // lent 500
    await debt(user, cash.id, "took", 300, "2026-01-02"); // repaid me 300 (B=500)
    await debt(user, cash.id, "took", 700, "2026-01-03"); // repaid me 200, borrowed 500

    expect(await labels(user)).toEqual([
      [
        "gave",
        {
          parts: [{ kind: "lent", amount: 500 }],
          settles: false,
          forecast: false,
        },
      ],
      [
        "took",
        {
          parts: [{ kind: "repaidToMe", amount: 300 }],
          settles: false,
          forecast: false,
        },
      ],
      [
        "took",
        {
          parts: [
            { kind: "repaidToMe", amount: 200 },
            { kind: "borrowed", amount: 500 },
          ],
          settles: false,
          forecast: false,
        },
      ],
    ]);
  });

  it("marks an exact settlement", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);

    await debt(user, cash.id, "took", 400, "2026-01-01"); // borrowed 400
    await debt(user, cash.id, "gave", 400, "2026-01-02"); // repaid 400, settles

    const [, second] = await labels(user);
    expect(second?.[1]).toEqual({
      parts: [{ kind: "repaid", amount: 400 }],
      settles: true,
      forecast: false,
    });
  });

  it("relabels later rows after a backdated insert", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);

    await debt(user, cash.id, "took", 100, "2026-01-10"); // borrowed 100 (B=0)
    expect((await labels(user))[0]?.[1]).toMatchObject({
      parts: [{ kind: "borrowed", amount: 100 }],
    });

    await debt(user, cash.id, "gave", 100, "2026-01-01"); // backdated: lent 100

    const [first, second] = await labels(user);
    expect(first?.[1]).toMatchObject({
      parts: [{ kind: "lent", amount: 100 }],
    });
    expect(second?.[1]).toMatchObject({
      parts: [{ kind: "repaidToMe", amount: 100 }],
      settles: true,
    });
  });

  it("keeps currencies separate for the same person", async () => {
    const user = await createUser();
    const uah = await makeAccount(user, { currencyId: CURRENCY.UAH });
    const usd = await makeAccount(user, { currencyId: CURRENCY.USD });

    await debt(user, uah.id, "gave", 500, "2026-01-01"); // lent 500 UAH
    await debt(user, usd.id, "took", 100, "2026-01-02"); // borrowed 100 USD

    const [, second] = await labels(user);
    expect(second?.[1]).toMatchObject({
      parts: [{ kind: "borrowed", amount: 100 }],
    });
  });

  it("orders same-day entries by entry time", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);

    await debt(user, cash.id, "gave", 100, "2026-01-01");
    await debt(user, cash.id, "took", 100, "2026-01-01");

    const [first, second] = await labels(user);
    expect(first?.[1]).toMatchObject({ parts: [{ kind: "lent" }] });
    expect(second?.[1]).toMatchObject({
      parts: [{ kind: "repaidToMe" }],
      settles: true,
    });
  });

  it("does not change a label when the list is filtered", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);
    await debt(user, cash.id, "gave", 500, "2026-01-01");
    await debt(user, cash.id, "took", 200, "2026-02-01");

    const { items } = await list(user, { startDate: "2026-02-01" });

    expect(items).toHaveLength(1);
    expect(items[0]?.debtLabel).toMatchObject({
      parts: [{ kind: "repaidToMe", amount: 200 }],
    });
  });

  it("labels planned rows as a forecast against the projected balance", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);
    await debt(user, cash.id, "gave", 500, "2026-01-01"); // lent 500

    // two planned repayments by Alex: 300, then 300 more
    const [row] = (await list(user)).items;
    const counterpartyId = row?.counterparty?.id ?? "";
    const debtAccountId = row?.linked?.account.id ?? "";

    for (const date of ["2026-05-01", "2026-06-01"]) {
      const batchId = `planned-${date}`;
      await insertTransactionRow({
        kind: "debt",
        batchId,
        date,
        accountId: cash.id,
        amount: 300,
        counterpartyId,
        isPlanned: true,
        createdBy: user.id,
      });
      await insertTransactionRow({
        kind: "debt",
        batchId,
        date,
        accountId: debtAccountId,
        amount: -300,
        counterpartyId,
        isPlanned: true,
        createdBy: user.id,
      });
    }

    const planned = await callerFor(user).transactions.planned({
      filter: noFilter,
    });

    expect(planned.items.map((item) => item.debtLabel)).toEqual([
      {
        parts: [{ kind: "repaidToMe", amount: 300 }],
        settles: false,
        forecast: true,
      },
      {
        parts: [
          { kind: "repaidToMe", amount: 200 },
          { kind: "borrowed", amount: 100 },
        ],
        settles: false,
        forecast: true,
      },
    ]);

    // planned rows never affect submitted labels
    expect((await list(user)).items[0]?.debtLabel).toMatchObject({
      parts: [{ kind: "lent", amount: 500 }],
    });
  });

  it("keeps the plain direction for old rows without a counterparty", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);
    const other = await makeAccount(user);
    const batchId = "old";
    await insertTransactionRow({
      kind: "debt",
      batchId,
      accountId: cash.id,
      amount: -100,
      createdBy: user.id,
    });
    await insertTransactionRow({
      kind: "debt",
      batchId,
      accountId: other.id,
      amount: 100,
      createdBy: user.id,
    });

    const [row] = (await list(user)).items;
    expect(row).toMatchObject({ direction: "gave", debtLabel: null });
  });
});
