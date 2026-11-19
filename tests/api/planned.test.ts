import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { plannedTransactions, transactions } from "~/server/db/schema";
import { occurrenceHash, regenerateAll } from "~/server/services/planned";
import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import { REFUSED_COMMENT, refusingComment } from "../helpers/faults";
import {
  createUser,
  grant,
  makeAccount,
  makeCategory,
  type TestUser,
} from "../helpers/fixtures";
import { signal, untilBlockedOnLock } from "../helpers/locks";
import { run } from "../helpers/run";

// "today" is 2026-03-15 in APP_TIMEZONE for every test here
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const none = { repeatType: "none" as const };

const liveRows = (where = isNull(transactions.deletedAt)) =>
  db.select().from(transactions).where(where).orderBy(transactions.date);

const plannedDates = async () =>
  (
    await liveRows(
      and(isNull(transactions.deletedAt), eq(transactions.isPlanned, true)),
    )
  ).map((row) => row.date);

const monthlyExpense = async (
  user: TestUser,
  accountId: string,
  schedule: Record<string, unknown> = {},
  date = "2026-03-20",
) =>
  callerFor(user).planned.create({
    data: { kind: "expense", date, amount: 1000, accountId },
    schedule: {
      repeatType: "monthly",
      repeatInterval: 1,
      endDate: "2026-06-30",
      ...schedule,
    },
  });

describe("planned.create", () => {
  it("repeat none creates planned rows without a schedule", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    await callerFor(user).planned.create({
      data: {
        kind: "expense",
        date: "2026-04-01",
        amount: 500,
        accountId: account.id,
      },
      schedule: none,
    });

    const [row] = await liveRows();
    expect(row).toMatchObject({
      isPlanned: true,
      plannedTransactionId: null,
      amount: -500,
      date: "2026-04-01",
    });
    expect(await db.select().from(plannedTransactions)).toEqual([]);
  });

  it("creates the schedule and its occurrences in one go", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const category = await makeCategory(user);

    const result = await callerFor(user).planned.create({
      data: {
        kind: "expense",
        date: "2026-03-20",
        amount: 1000,
        accountId: account.id,
        categoryId: category.id,
        comment: "rent",
        counterparty: { name: "Landlord" },
      },
      schedule: {
        repeatType: "monthly",
        repeatInterval: 1,
        endDate: "2026-06-30",
      },
    });

    expect(result.occurrences).toBe(4);

    const rows = await liveRows();
    expect(rows.map((row) => row.date)).toEqual([
      "2026-03-20",
      "2026-04-20",
      "2026-05-20",
      "2026-06-20",
    ]);
    expect(
      rows.every(
        (row) =>
          row.isPlanned &&
          row.amount === -1000 &&
          row.categoryId === category.id &&
          row.comment === "rent" &&
          row.counterpartyId !== null &&
          row.plannedTransactionId === result.scheduleId &&
          row.plannedHash === occurrenceHash(row.date, result.scheduleId ?? ""),
      ),
    ).toBe(true);

    // occurrences never touch the balance
    const [listed] = await callerFor(user).accounts.list();
    expect(listed?.balance).toBe(0);
  });

  it("gives a transfer two schedule legs and both occurrence legs the primary id", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);

    const result = await callerFor(user).planned.create({
      data: {
        kind: "transfer",
        date: "2026-03-20",
        amount: 100,
        accountId: a.id,
        linkedAccountId: b.id,
        linkedAmount: 90,
      },
      schedule: {
        repeatType: "monthly",
        repeatInterval: 1,
        endDate: "2026-04-30",
      },
    });

    const schedules = await db.select().from(plannedTransactions);
    expect(schedules).toHaveLength(2);
    expect(new Set(schedules.map((s) => s.batchId)).size).toBe(1);
    expect(schedules.find((s) => s.amount < 0)?.id).toBe(result.scheduleId);

    const rows = await liveRows();
    expect(rows).toHaveLength(4);
    expect(
      rows.every((row) => row.plannedTransactionId === result.scheduleId),
    ).toBe(true);

    const batches = new Set(rows.map((row) => row.batchId));
    expect(batches.size).toBe(2);
  });

  it("generates weekly occurrences on the chosen weekdays", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    await callerFor(user).planned.create({
      data: {
        kind: "expense",
        date: "2026-03-18",
        amount: 1,
        accountId: account.id,
      },
      schedule: {
        repeatType: "weekly",
        repeatInterval: 1,
        repeatWeekdays: [1, 5],
        endDate: "2026-03-30",
      },
    });

    expect(await plannedDates()).toEqual([
      "2026-03-20",
      "2026-03-23",
      "2026-03-27",
      "2026-03-30",
    ]);
  });

  it("validates weekdays and the end date", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const data = {
      kind: "expense" as const,
      date: "2026-03-20",
      amount: 1,
      accountId: account.id,
    };

    const missing = await expectTRPCError(
      callerFor(user).planned.create({
        data,
        schedule: {
          repeatType: "weekly",
          repeatInterval: 1,
          repeatWeekdays: [],
        },
      }),
      "BAD_REQUEST",
    );
    expect(JSON.stringify(missing.cause)).toContain("weekdays_required");

    const wrong = await expectTRPCError(
      callerFor(user).planned.create({
        data,
        schedule: {
          repeatType: "weekly",
          repeatInterval: 1,
          repeatWeekdays: [8],
        },
      }),
      "BAD_REQUEST",
    );
    expect(JSON.stringify(wrong.cause)).toContain("incorrect_weekday");

    const early = await expectTRPCError(
      callerFor(user).planned.create({
        data,
        schedule: {
          repeatType: "daily",
          repeatInterval: 1,
          endDate: "2026-03-01",
        },
      }),
      "BAD_REQUEST",
    );
    expect(JSON.stringify(early.cause)).toContain("end_date_gte_start_date");

    await expectTRPCError(
      callerFor(user).planned.create({
        data,
        schedule: { repeatType: "daily", repeatInterval: 32 },
      }),
      "BAD_REQUEST",
    );
  });

  it("applies the same integrity and permission rules as transactions", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, reader);

    await expectTRPCError(monthlyExpense(reader, account.id), "FORBIDDEN");
    expect(await db.select().from(plannedTransactions)).toEqual([]);
  });

  it("stops at one year ahead without an end date", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    await monthlyExpense(user, account.id, { endDate: null });

    const dates = await plannedDates();
    expect(dates[0]).toBe("2026-03-20");
    expect(dates.at(-1)).toBe("2027-02-20");
  });
});

describe("generation", () => {
  it("is idempotent", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await monthlyExpense(user, account.id);

    const again = await run(regenerateAll());

    expect(again.occurrences).toBe(0);
    expect(await plannedDates()).toHaveLength(4);
  });

  it("never brings back a submitted or deleted occurrence", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await monthlyExpense(user, account.id);
    const [first, second] = await liveRows();

    await callerFor(user).transactions.update({
      id: first?.id ?? "",
      data: {
        kind: "expense",
        date: "2026-03-20",
        amount: 1000,
        accountId: account.id,
      },
    });
    await callerFor(user).transactions.delete({ id: second?.id ?? "" });

    await run(regenerateAll());

    expect(await plannedDates()).toEqual(["2026-05-20", "2026-06-20"]);
  });

  it("skips a schedule that fails and still generates the others", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await monthlyExpense(user, account.id, { endDate: null });
    const failing = await callerFor(user).planned.create({
      data: {
        kind: "expense",
        date: "2026-03-21",
        amount: 500,
        accountId: account.id,
        comment: REFUSED_COMMENT,
      },
      schedule: { repeatType: "monthly", repeatInterval: 1, endDate: null },
    });
    const before = (await plannedDates()).length;

    vi.setSystemTime(new Date("2026-04-25T09:00:00Z"));
    const result = await refusingComment(() => run(regenerateAll()));

    expect(result).toMatchObject({ schedules: 2, occurrences: 2, failed: 1 });
    expect(await plannedDates()).toHaveLength(before + 2);
    expect(
      (await liveRows()).filter(
        (row) => row.plannedTransactionId === failing.scheduleId,
      ),
    ).toHaveLength(12);
  });

  it("counts a schedule deleted while it waited as nothing to generate", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const result = await monthlyExpense(user, account.id);
    const scheduleId = result.scheduleId ?? "";

    // the delete holds the schedule row when the nightly run reaches it
    const held = signal();
    const commit = signal();
    const deleting = db.transaction(async (tx) => {
      await tx
        .update(plannedTransactions)
        .set({ deletedAt: new Date() })
        .where(eq(plannedTransactions.id, scheduleId));
      held.resolve();
      await commit.promise;
    });
    await held.promise;

    const generating = run(regenerateAll());
    await untilBlockedOnLock();
    commit.resolve();
    await deleting;

    expect(await generating).toEqual({
      schedules: 1,
      occurrences: 0,
      failed: 0,
    });
  });

  it("rolls the one-year window forward as days pass", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await monthlyExpense(user, account.id, { endDate: null });
    expect((await plannedDates()).at(-1)).toBe("2027-02-20");

    vi.setSystemTime(new Date("2026-04-25T09:00:00Z"));
    const result = await run(regenerateAll());

    expect(result.occurrences).toBe(2);
    expect((await plannedDates()).at(-1)).toBe("2027-04-20");
  });
});

describe("planned.deleteAll", () => {
  it("deletes the occurrence, the schedule legs and the remaining planned rows", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);
    await callerFor(user).planned.create({
      data: {
        kind: "transfer",
        date: "2026-03-20",
        amount: 100,
        accountId: a.id,
        linkedAccountId: b.id,
        linkedAmount: 100,
      },
      schedule: {
        repeatType: "monthly",
        repeatInterval: 1,
        endDate: "2026-06-30",
      },
    });

    const planned = await callerFor(user).transactions.planned({
      filter: { accounts: [], categories: [], counterparties: [] },
    });
    const [first, second] = planned.items;

    // submit the first one: it has to survive
    await callerFor(user).transactions.update({
      id: first?.id ?? "",
      data: {
        kind: "transfer",
        date: "2026-03-20",
        amount: 100,
        accountId: a.id,
        linkedAccountId: b.id,
        linkedAmount: 100,
      },
    });

    await callerFor(user).planned.deleteAll({ id: second?.id ?? "" });

    const schedules = await db.select().from(plannedTransactions);
    expect(schedules.every((s) => s.deletedAt !== null)).toBe(true);

    const live = await liveRows();
    expect(live).toHaveLength(2);
    expect(live.every((row) => !row.isPlanned)).toBe(true);

    // and nothing comes back
    await run(regenerateAll());
    expect(await plannedDates()).toEqual([]);
  });

  it("refuses submitted and one-off rows", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const { ids } = await callerFor(user).transactions.create({
      kind: "expense",
      date: "2026-03-10",
      amount: 1,
      accountId: account.id,
    });
    await expectTRPCError(
      callerFor(user).planned.deleteAll({ id: ids[0] ?? "" }),
      "BAD_REQUEST",
      "not_planned",
    );

    await callerFor(user).planned.create({
      data: {
        kind: "expense",
        date: "2026-04-01",
        amount: 1,
        accountId: account.id,
      },
      schedule: none,
    });
    const oneOff = (await liveRows()).find((row) => row.isPlanned);
    await expectTRPCError(
      callerFor(user).planned.deleteAll({ id: oneOff?.id ?? "" }),
      "BAD_REQUEST",
      "not_recurring",
    );
  });

  it("needs write access", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, reader);
    await monthlyExpense(owner, account.id);
    const [row] = await liveRows();

    await expectTRPCError(
      callerFor(reader).planned.deleteAll({ id: row?.id ?? "" }),
      "FORBIDDEN",
    );
  });
});

describe("planned.updateSchedule", () => {
  it("rewrites future occurrences, keeps overdue ones", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const result = await monthlyExpense(user, account.id, {}, "2026-02-10");
    // Feb 10 and Mar 10 are overdue on Mar 15; Apr, May, Jun are future
    expect(await plannedDates()).toHaveLength(5);

    await callerFor(user).planned.updateSchedule({
      scheduleId: result.scheduleId ?? "",
      data: {
        kind: "expense",
        date: "2026-02-10",
        amount: 2500,
        accountId: account.id,
      },
      schedule: {
        repeatType: "monthly",
        repeatInterval: 2,
        endDate: "2026-06-30",
      },
    });

    const rows = await liveRows(
      and(isNull(transactions.deletedAt), eq(transactions.isPlanned, true)),
    );
    expect(rows.map((row) => [row.date, row.amount])).toEqual([
      ["2026-02-10", -1000],
      ["2026-03-10", -1000],
      ["2026-04-10", -2500],
      ["2026-06-10", -2500],
    ]);

    const schedule = await db.query.plannedTransactions.findFirst({
      where: eq(plannedTransactions.id, result.scheduleId ?? ""),
    });
    expect(schedule).toMatchObject({ amount: -2500, repeatInterval: 2 });
  });

  it("keeps occurrences the user deleted one by one out", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const result = await monthlyExpense(user, account.id);
    const april = (await liveRows()).find((row) => row.date === "2026-04-20");
    await callerFor(user).transactions.delete({ id: april?.id ?? "" });

    await callerFor(user).planned.updateSchedule({
      scheduleId: result.scheduleId ?? "",
      data: {
        kind: "expense",
        date: "2026-03-20",
        amount: 700,
        accountId: account.id,
      },
      schedule: {
        repeatType: "monthly",
        repeatInterval: 1,
        endDate: "2026-06-30",
      },
    });

    expect(await plannedDates()).toEqual([
      "2026-03-20",
      "2026-05-20",
      "2026-06-20",
    ]);
  });

  it("keeps the primary leg when a debt schedule flips direction", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);
    const result = await callerFor(user).planned.create({
      data: {
        kind: "debt",
        date: "2026-03-20",
        amount: 100,
        accountId: cash.id,
        direction: "gave",
        counterparty: { name: "Alex" },
      },
      schedule: {
        repeatType: "monthly",
        repeatInterval: 1,
        endDate: "2026-04-30",
      },
    });

    await callerFor(user).planned.updateSchedule({
      scheduleId: result.scheduleId ?? "",
      data: {
        kind: "debt",
        date: "2026-03-20",
        amount: 100,
        accountId: cash.id,
        direction: "took",
        counterparty: { name: "Alex" },
      },
      schedule: {
        repeatType: "monthly",
        repeatInterval: 1,
        endDate: "2026-04-30",
      },
    });

    const rows = await liveRows();
    expect(rows).toHaveLength(4);
    expect(
      rows.every((row) => row.plannedTransactionId === result.scheduleId),
    ).toBe(true);
    expect(rows.find((row) => row.accountId === cash.id)?.amount).toBe(100);

    // idempotent afterwards
    expect((await run(regenerateAll())).occurrences).toBe(0);
  });

  it("refuses a kind change", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const result = await monthlyExpense(user, account.id);

    await expectTRPCError(
      callerFor(user).planned.updateSchedule({
        scheduleId: result.scheduleId ?? "",
        data: {
          kind: "income",
          date: "2026-03-20",
          amount: 1,
          accountId: account.id,
        },
        schedule: { repeatType: "monthly", repeatInterval: 1 },
      }),
      "BAD_REQUEST",
      "type_change_not_supported",
    );
  });

  it("refuses the edit form to someone who can't write the schedule", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, reader, { canWrite: false });
    const result = await monthlyExpense(owner, account.id);

    await expectTRPCError(
      callerFor(reader).planned.schedule({ id: result.scheduleId ?? "" }),
      "FORBIDDEN",
    );
  });

  it("returns the schedule for the edit form", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const result = await monthlyExpense(user, account.id);

    expect(
      await callerFor(user).planned.schedule({ id: result.scheduleId ?? "" }),
    ).toMatchObject({
      id: result.scheduleId,
      repeatType: "monthly",
      repeatInterval: 1,
      startDate: "2026-03-20",
      endDate: "2026-06-30",
    });
  });
});

describe("transactions.planned nextOnly", () => {
  const noFilter = { accounts: [], categories: [], counterparties: [] };

  it("keeps the next occurrence of each series, pairs and one-offs included", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);
    const c = callerFor(user);
    const until = { repeatInterval: 1, endDate: "2026-06-30" };

    await c.planned.create({
      data: {
        kind: "expense",
        date: "2026-03-20",
        amount: 10,
        accountId: a.id,
      },
      schedule: { repeatType: "monthly", ...until },
    });
    await c.planned.create({
      data: {
        kind: "transfer",
        date: "2026-03-18",
        amount: 100,
        accountId: a.id,
        linkedAccountId: b.id,
        linkedAmount: 100,
      },
      schedule: { repeatType: "monthly", ...until },
    });
    await c.planned.create({
      data: { kind: "income", date: "2026-05-01", amount: 5, accountId: a.id },
      schedule: none,
    });

    // every date: more than one page (the limit here is 3)
    const all = await c.transactions.planned({ filter: noFilter });
    const next = await c.transactions.planned({
      filter: noFilter,
      nextOnly: true,
    });

    expect(all.nextCursor).not.toBeNull();
    expect(next.nextCursor).toBeNull();
    expect(next.items.map((item) => [item.kind, item.date])).toEqual([
      ["transfer", "2026-03-18"],
      ["expense", "2026-03-20"],
      ["income", "2026-05-01"],
    ]);
  });

  it("moves on to the following date once the next one is paid", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const c = callerFor(user);

    await c.planned.create({
      data: {
        kind: "expense",
        date: "2026-03-20",
        amount: 10,
        accountId: account.id,
      },
      schedule: {
        repeatType: "monthly",
        repeatInterval: 1,
        endDate: "2026-06-30",
      },
    });

    const [first] = (
      await c.transactions.planned({ filter: noFilter, nextOnly: true })
    ).items;
    await c.transactions.submit({ id: first?.id ?? "" });

    const next = await c.transactions.planned({
      filter: noFilter,
      nextOnly: true,
    });
    expect(next.items.map((item) => item.date)).toEqual(["2026-04-20"]);
  });
});

describe("transactions.totals nextOnly", () => {
  type Filter = {
    accounts: string[];
    categories: string[];
    counterparties: string[];
    kinds?: ("expense" | "income" | "transfer" | "debt")[];
    amount?: string;
    comment?: string;
  };

  const only = (accountId: string): Filter => ({
    accounts: [accountId],
    categories: [],
    counterparties: [],
  });

  const monthly = {
    repeatType: "monthly" as const,
    repeatInterval: 1,
    endDate: "2026-06-30",
  };

  /** The planned totals as the Planned page asks for them */
  const plannedTotals = (user: TestUser, filter: Filter, nextOnly: boolean) =>
    callerFor(user).transactions.totals({ filter, planned: true, nextOnly });

  /** Every page of the planned list */
  const plannedList = async (
    user: TestUser,
    filter: Filter,
    nextOnly: boolean,
  ) => {
    const c = callerFor(user);
    const items = [];
    let cursor = null;

    do {
      const page: Awaited<ReturnType<typeof c.transactions.planned>> =
        await c.transactions.planned({ filter, nextOnly, cursor });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    return items;
  };

  it("counts one occurrence of each series, like the list (the reported bug)", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);
    const c = callerFor(user);

    // 5.00 a month, four dates up to the end date
    await c.planned.create({
      data: {
        kind: "expense",
        date: "2026-03-20",
        amount: 500,
        accountId: a.id,
      },
      schedule: monthly,
    });
    await c.planned.create({
      data: {
        kind: "expense",
        date: "2026-03-21",
        amount: 700,
        accountId: b.id,
      },
      schedule: monthly,
    });

    const shown = await plannedList(user, only(a.id), true);
    expect(shown.map((row) => [row.date, row.amount])).toEqual([
      ["2026-03-20", -500],
    ]);

    expect(await plannedTotals(user, only(a.id), true)).toEqual([
      expect.objectContaining({ expenses: -500, incomes: 0, total: -500 }),
    ]);
    expect(await plannedTotals(user, only(a.id), false)).toEqual([
      expect.objectContaining({ expenses: -2000, incomes: 0, total: -2000 }),
    ]);
  });

  it("sums exactly the rows the list shows, across pages, without own transfers", async () => {
    const user = await createUser();
    const a = await makeAccount(user);
    const b = await makeAccount(user);
    const c = callerFor(user);

    await c.planned.create({
      data: {
        kind: "expense",
        date: "2026-03-20",
        amount: 1000,
        accountId: a.id,
      },
      schedule: monthly,
    });
    await c.planned.create({
      data: {
        kind: "income",
        date: "2026-03-25",
        amount: 3000,
        accountId: a.id,
      },
      schedule: monthly,
    });
    await c.planned.create({
      data: {
        kind: "transfer",
        date: "2026-03-18",
        amount: 200,
        accountId: a.id,
        linkedAccountId: b.id,
        linkedAmount: 200,
      },
      schedule: monthly,
    });
    await c.planned.create({
      data: { kind: "income", date: "2026-05-01", amount: 50, accountId: a.id },
      schedule: none,
    });

    // four rows: more than one page (the limit here is 3)
    const shown = await plannedList(user, only(a.id), true);
    expect(shown.map((row) => [row.kind, row.date])).toEqual([
      ["transfer", "2026-03-18"],
      ["expense", "2026-03-20"],
      ["income", "2026-03-25"],
      ["income", "2026-05-01"],
    ]);

    const counted = shown.filter((row) => row.kind !== "transfer");
    const sum = (sign: 1 | -1) =>
      counted
        .map((row) => row.amount)
        .filter((amount) => Math.sign(amount) === sign)
        .reduce((total, amount) => total + amount, 0);

    const [next] = await plannedTotals(user, only(a.id), true);
    expect(next).toMatchObject({
      expenses: sum(-1),
      incomes: sum(1),
      total: sum(-1) + sum(1),
    });
    expect(next).toMatchObject({ expenses: -1000, incomes: 3050, total: 2050 });

    expect(await plannedTotals(user, only(a.id), false)).toEqual([
      expect.objectContaining({
        expenses: -4000,
        incomes: 12_050,
        total: 8050,
      }),
    ]);
  });

  it.each([
    {
      name: "kind",
      filter: (): Partial<Filter> => ({ kinds: ["expense"] }),
      next: { expenses: -1250, incomes: 0 },
      all: { expenses: -5000, incomes: 0 },
    },
    {
      name: "income kind",
      filter: (): Partial<Filter> => ({ kinds: ["income"] }),
      next: { expenses: 0, incomes: 3000 },
      all: { expenses: 0, incomes: 12_000 },
    },
    {
      name: "category",
      filter: (categoryId: string): Partial<Filter> => ({
        categories: [categoryId],
      }),
      next: { expenses: -1000, incomes: 0 },
      all: { expenses: -4000, incomes: 0 },
    },
    {
      name: "amount",
      filter: (): Partial<Filter> => ({ amount: "10" }),
      next: { expenses: -1000, incomes: 0 },
      all: { expenses: -4000, incomes: 0 },
    },
    {
      name: "comment",
      filter: (): Partial<Filter> => ({ comment: "coff" }),
      next: { expenses: -250, incomes: 0 },
      all: { expenses: -1000, incomes: 0 },
    },
  ])("follows the $name filter", async ({ filter, next, all }) => {
    const user = await createUser();
    const account = await makeAccount(user);
    const category = await makeCategory(user);
    const c = callerFor(user);

    await c.planned.create({
      data: {
        kind: "expense",
        date: "2026-03-20",
        amount: 1000,
        accountId: account.id,
        categoryId: category.id,
        comment: "rent",
      },
      schedule: monthly,
    });
    await c.planned.create({
      data: {
        kind: "expense",
        date: "2026-03-16",
        amount: 250,
        accountId: account.id,
        comment: "coffee",
      },
      schedule: monthly,
    });
    await c.planned.create({
      data: {
        kind: "income",
        date: "2026-03-25",
        amount: 3000,
        accountId: account.id,
      },
      schedule: monthly,
    });

    const filtered = { ...only(account.id), ...filter(category.id) };
    const [nextTotals] = await plannedTotals(user, filtered, true);
    const [allTotals] = await plannedTotals(user, filtered, false);

    expect(nextTotals).toMatchObject(next);
    expect(allTotals).toMatchObject(all);
  });

  it("counts a debt series once, by its real-account leg", async () => {
    const user = await createUser();
    const cash = await makeAccount(user);
    const c = callerFor(user);

    await c.planned.create({
      data: {
        kind: "debt",
        date: "2026-03-20",
        amount: 100,
        accountId: cash.id,
        direction: "gave",
        counterparty: { name: "Alex" },
      },
      schedule: monthly,
    });
    await c.planned.create({
      data: {
        kind: "debt",
        date: "2026-03-22",
        amount: 300,
        accountId: cash.id,
        direction: "took",
        counterparty: { name: "Bob" },
      },
      schedule: monthly,
    });

    const series = await plannedList(user, only(cash.id), true);
    const filter: Filter = {
      accounts: [],
      categories: [],
      counterparties: series.flatMap((row) =>
        row.counterparty ? [row.counterparty.id] : [],
      ),
    };
    expect(filter.counterparties).toHaveLength(2);

    expect(await plannedTotals(user, filter, true)).toEqual([
      expect.objectContaining({
        currencyId: cash.currencyId,
        expenses: -100,
        incomes: 300,
        debtExpenses: -100,
        debtIncomes: 300,
      }),
    ]);
    expect(await plannedTotals(user, filter, false)).toEqual([
      expect.objectContaining({ expenses: -400, incomes: 1200 }),
    ]);
  });

  it("moves on to the following date once the next one is paid", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const c = callerFor(user);

    await monthlyExpense(user, account.id);

    const [first] = await plannedList(user, only(account.id), true);
    await c.transactions.submit({ id: first?.id ?? "" });

    expect(await plannedTotals(user, only(account.id), true)).toEqual([
      expect.objectContaining({ expenses: -1000 }),
    ]);
    expect(await plannedTotals(user, only(account.id), false)).toEqual([
      expect.objectContaining({ expenses: -3000 }),
    ]);
  });

  it("counts an overdue occurrence as the series' next one", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    await monthlyExpense(user, account.id);
    // March and April are now overdue and un-submitted
    vi.setSystemTime(new Date("2026-04-25T09:00:00Z"));

    const shown = await plannedList(user, only(account.id), true);
    expect(shown.map((row) => row.date)).toEqual(["2026-03-20"]);
    expect(await plannedTotals(user, only(account.id), true)).toEqual([
      expect.objectContaining({ expenses: -1000 }),
    ]);
  });

  it("is ignored for submitted totals", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const c = callerFor(user);

    await monthlyExpense(user, account.id);

    // pay April early while March is still planned: an earlier live
    // occurrence of the same series exists
    const april = (await plannedList(user, only(account.id), false)).find(
      (row) => row.date === "2026-04-20",
    );
    await c.transactions.submit({ id: april?.id ?? "" });

    expect(
      await c.transactions.totals({ filter: only(account.id), nextOnly: true }),
    ).toEqual([expect.objectContaining({ expenses: -1000 })]);
  });
});
