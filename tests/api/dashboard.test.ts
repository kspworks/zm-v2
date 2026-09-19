import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import {
  CURRENCY,
  createUser,
  grant,
  makeAccount,
  makeCategory,
  type TestUser,
} from "../helpers/fixtures";

// "today" is 2026-03-15 in APP_TIMEZONE for every test here
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const none = { repeatType: "none" as const };

const plan = (
  user: TestUser,
  data: Parameters<
    ReturnType<typeof callerFor>["planned"]["create"]
  >[0]["data"],
) => callerFor(user).planned.create({ data, schedule: none });

const range = { back: 3, ahead: 3 };

const point = <T extends { date: string }>(points: T[], date: string) => {
  const found = points.find((p) => p.date === date);

  if (!found) {
    throw new Error(`no point for ${date}`);
  }

  return found;
};

describe("dashboard.balance", () => {
  it("draws actual then planned balance, only for the selected scope", async () => {
    const user = await createUser();
    const other = await createUser();
    const card = await makeAccount(user, { initialBalance: 10_000 });
    const cash = await makeAccount(user, { type: "cash" });
    const usd = await makeAccount(user, { currencyId: CURRENCY.USD });
    const inactive = await makeAccount(user, { isActive: false });
    const hidden = await makeAccount(other, { initialBalance: 99_999 });
    const food = await makeCategory(user, { name: "Food" });
    const c = callerFor(user);

    // before the window: part of the opening balance
    await c.transactions.create({
      kind: "expense",
      date: "2026-03-01",
      amount: 1000,
      accountId: card.id,
    });
    await c.transactions.create({
      kind: "expense",
      date: "2026-03-13",
      amount: 500,
      accountId: card.id,
      categoryId: food.id,
    });
    // own transfer without a fee: balance unchanged, not listed
    await c.transactions.create({
      kind: "transfer",
      date: "2026-03-13",
      amount: 2000,
      accountId: card.id,
      linkedAccountId: cash.id,
      linkedAmount: 2000,
    });
    // with a fee: listed as the fee only
    await c.transactions.create({
      kind: "transfer",
      date: "2026-03-14",
      amount: 1000,
      accountId: card.id,
      linkedAccountId: cash.id,
      linkedAmount: 990,
    });
    // cross-currency: the UAH leg counts as an outflow
    await c.transactions.create({
      kind: "transfer",
      date: "2026-03-14",
      amount: 400,
      accountId: card.id,
      linkedAccountId: usd.id,
      linkedAmount: 10,
    });
    // ignored: inactive account, other currency
    await c.transactions.create({
      kind: "income",
      date: "2026-03-14",
      amount: 777,
      accountId: inactive.id,
    });
    await c.transactions.create({
      kind: "income",
      date: "2026-03-14",
      amount: 777,
      accountId: usd.id,
    });
    // overdue planned: due today
    await plan(user, {
      kind: "expense",
      date: "2026-03-10",
      amount: 300,
      accountId: card.id,
    });
    await plan(user, {
      kind: "income",
      date: "2026-03-17",
      amount: 5000,
      accountId: cash.id,
    });
    await callerFor(other).transactions.create({
      kind: "expense",
      date: "2026-03-14",
      amount: 1,
      accountId: hidden.id,
    });

    const points = await c.dashboard.balance({
      currencyId: CURRENCY.UAH,
      ...range,
    });

    expect(points.map((p) => p.date)).toEqual([
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
      "2026-03-16",
      "2026-03-17",
      "2026-03-18",
    ]);
    expect(point(points, "2026-03-12").actual).toBe(9000);
    expect(point(points, "2026-03-13")).toMatchObject({
      actual: 8500,
      items: [expect.objectContaining({ net: -500, category: "Food" })],
    });
    expect(point(points, "2026-03-14").actual).toBe(8090);
    expect(
      point(points, "2026-03-14")
        .items.map((i) => i.net)
        .sort(),
    ).toEqual([-10, -400].sort());
    expect(point(points, "2026-03-15")).toMatchObject({
      actual: 8090,
      planned: 7790,
      items: [expect.objectContaining({ net: -300, overdue: true })],
    });
    expect(point(points, "2026-03-17").planned).toBe(12_790);
    expect(point(points, "2026-03-18")).toMatchObject({
      actual: null,
      planned: 12_790,
    });

    // today's actual point matches the accounts' derived balances
    const accounts = await c.accounts.list();
    const available = accounts
      .filter((a) => a.isActive && a.currencyId === CURRENCY.UAH)
      .reduce((sum, a) => sum + a.balance, 0);
    expect(point(points, "2026-03-15").actual).toBe(available);
  });

  it("includes shared accounts the user can read", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const shared = await makeAccount(owner, { initialBalance: 700 });
    await grant("account", shared.id, viewer);

    const points = await callerFor(viewer).dashboard.balance({
      currencyId: CURRENCY.UAH,
      ...range,
    });

    expect(point(points, "2026-03-15").actual).toBe(700);
  });

  it("rejects a range outside 1..90 days", async () => {
    const user = await createUser();

    await expectTRPCError(
      callerFor(user).dashboard.balance({
        currencyId: CURRENCY.UAH,
        back: 0,
        ahead: 91,
      }),
      "BAD_REQUEST",
    );
  });
});

describe("dashboard.forecast", () => {
  it("returns nine reconciling months with overdue rows in this one", async () => {
    const user = await createUser();
    const card = await makeAccount(user, { initialBalance: 10_000 });
    const c = callerFor(user);

    await c.transactions.create({
      kind: "expense",
      date: "2026-02-20",
      amount: 1000,
      accountId: card.id,
    });
    await c.transactions.create({
      kind: "income",
      date: "2026-03-02",
      amount: 3000,
      accountId: card.id,
    });
    await plan(user, {
      kind: "expense",
      date: "2026-02-25",
      amount: 200,
      accountId: card.id,
    });
    await c.planned.create({
      data: {
        kind: "expense",
        date: "2026-04-05",
        amount: 1500,
        accountId: card.id,
      },
      schedule: {
        repeatType: "monthly",
        repeatInterval: 1,
        endDate: "2026-06-30",
      },
    });

    const months = await c.dashboard.forecast({ currencyId: CURRENCY.UAH });

    expect(months).toHaveLength(9);
    expect(months[0]).toEqual({
      month: "2026-03",
      income: 3000,
      expense: -200,
      balance: 11_800,
    });
    expect(
      months.slice(1, 5).map((m) => [m.month, m.expense, m.balance]),
    ).toEqual([
      ["2026-04", -1500, 10_300],
      ["2026-05", -1500, 8800],
      ["2026-06", -1500, 7300],
      ["2026-07", 0, 7300],
    ]);
    expect(months.at(-1)?.month).toBe("2026-11");

    let previous = 9000;
    for (const m of months) {
      expect(m.balance).toBe(previous + m.income + m.expense);
      previous = m.balance;
    }
  });
});

describe("dashboard.nearest", () => {
  it("skips empty days, puts overdue on today and caps at ten dates", async () => {
    const user = await createUser();
    const card = await makeAccount(user);
    const usd = await makeAccount(user, { currencyId: CURRENCY.USD });
    const c = callerFor(user);

    await plan(user, {
      kind: "expense",
      date: "2026-03-01",
      amount: 100,
      accountId: card.id,
    });

    for (const day of [17, 20, 21, 23, 24, 25, 26, 27, 28, 30, 31]) {
      await plan(user, {
        kind: "expense",
        date: `2026-03-${day}`,
        amount: day,
        accountId: card.id,
      });
    }

    await plan(user, {
      kind: "income",
      date: "2026-03-20",
      amount: 5,
      accountId: usd.id,
    });
    // submitted rows never show here
    await c.transactions.create({
      kind: "expense",
      date: "2026-03-16",
      amount: 1,
      accountId: card.id,
    });

    const days = await c.dashboard.nearest();

    expect(days.map((d) => d.date)).toEqual([
      "2026-03-15",
      "2026-03-17",
      "2026-03-20",
      "2026-03-21",
      "2026-03-23",
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
    ]);
    expect(days[0]?.items).toEqual([
      expect.objectContaining({ net: -100, overdue: true }),
    ]);
    expect(days[2]?.items.map((i) => [i.net, i.currencySign]).sort()).toEqual(
      [
        [-20, "₴"],
        [5, "$"],
      ].sort(),
    );
  });
});
