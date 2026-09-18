import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { plannedTransactions, transactions } from "~/server/db/schema";
import { occurrenceHash, regenerateAll } from "~/server/services/planned";
import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import {
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

    const again = await regenerateAll(db);

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

    await regenerateAll(db);

    expect(await plannedDates()).toEqual(["2026-05-20", "2026-06-20"]);
  });

  it("rolls the one-year window forward as days pass", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await monthlyExpense(user, account.id, { endDate: null });
    expect((await plannedDates()).at(-1)).toBe("2027-02-20");

    vi.setSystemTime(new Date("2026-04-25T09:00:00Z"));
    const result = await regenerateAll(db);

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
    await regenerateAll(db);
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
    expect((await regenerateAll(db)).occurrences).toBe(0);
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
