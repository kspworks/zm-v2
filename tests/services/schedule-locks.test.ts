import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { transaction } from "~/server/db/database";
import { plannedTransactions, transactions } from "~/server/db/schema";
import { generateOccurrences, updateSchedule } from "~/server/services/planned";
import { callerFor } from "../helpers/caller";
import { createUser, makeAccount } from "../helpers/fixtures";
import { signal, untilBlockedOnLock } from "../helpers/locks";
import { run } from "../helpers/run";

// "today" is 2026-03-15 in APP_TIMEZONE
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const livePlanned = (scheduleId: string) =>
  db
    .select({ date: transactions.date, hash: transactions.plannedHash })
    .from(transactions)
    .where(
      and(
        eq(transactions.plannedTransactionId, scheduleId),
        eq(transactions.isPlanned, true),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(transactions.date);

describe("a schedule edit racing the nightly generation", () => {
  it("queues both on the schedule's rows instead of deadlocking", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const created = await callerFor(user).planned.create({
      data: {
        kind: "expense",
        date: "2026-03-20",
        amount: 1000,
        accountId: account.id,
      },
      schedule: {
        repeatType: "monthly",
        repeatInterval: 1,
        endDate: "2026-06-30",
      },
    });
    const scheduleId = created.scheduleId ?? "";

    // a third session holds the schedule row, so the edit and the generation
    // both start and wait; before the fix they took the schedule's advisory
    // lock and its row lock in opposite orders and one died in a deadlock
    const held = signal();
    const release = signal();
    const holding = db.transaction(async (tx) => {
      await tx
        .select({ id: plannedTransactions.id })
        .from(plannedTransactions)
        .where(eq(plannedTransactions.id, scheduleId))
        .for("update");
      held.resolve();
      await release.promise;
    });
    await held.promise;

    const editing = run(
      updateSchedule(user.id, {
        scheduleId,
        data: {
          kind: "expense",
          date: "2026-03-25",
          amount: 2000,
          accountId: account.id,
          categoryId: null,
          comment: null,
        },
        schedule: {
          repeatType: "monthly",
          repeatInterval: 1,
          repeatWeekdays: [],
          endDate: "2026-06-30",
        },
      }),
    );
    const generating = run(transaction(generateOccurrences(scheduleId)));

    await untilBlockedOnLock(2);
    release.resolve();
    await holding;

    await expect(editing).resolves.toMatchObject({ scheduleId });
    await expect(generating).resolves.toBeTypeOf("number");

    const rows = await livePlanned(scheduleId);
    expect(rows.map((row) => row.date)).toEqual([
      "2026-03-25",
      "2026-04-25",
      "2026-05-25",
      "2026-06-25",
    ]);
    expect(new Set(rows.map((row) => row.hash)).size).toBe(rows.length);
  });
});
