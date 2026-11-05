import { createHash } from "node:crypto";

import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import { occurrenceDates } from "~/lib/schedule";
import type { ScheduleFields } from "~/lib/validators/planned";
import type { TransactionInput } from "~/lib/validators/transactions";
import { query, transaction } from "~/server/db/database";
import { plannedTransactions, transactions } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now, today as todayInAppZone } from "~/server/lib/clock";
import { badRequest, notFound } from "~/server/lib/errors";
import { newId } from "~/server/lib/ids";
import {
  insertLegs,
  type Leg,
  prepareLegs,
  requireDeletable,
} from "~/server/services/transactions";

type Schedule = typeof plannedTransactions.$inferSelect;

/** The occurrence hash: md5(date + primary schedule id) */
export const occurrenceHash = (date: string, primaryScheduleId: string) =>
  createHash("md5").update(`${date}${primaryScheduleId}`).digest("hex");

const lockSchedule = (primaryScheduleId: string) =>
  query((db) =>
    db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`schedule:${primaryScheduleId}`}))`,
    ),
  );

/** A schedule's live legs, found by either leg's id, locked */
const loadScheduleBatch = Effect.fnUntraced(function* (id: string) {
  const [row] = yield* query((db) =>
    db
      .select()
      .from(plannedTransactions)
      .where(
        and(
          eq(plannedTransactions.id, id),
          isNull(plannedTransactions.deletedAt),
        ),
      )
      .for("update"),
  );

  if (!row) {
    return yield* notFound();
  }

  const batchId = row.batchId;

  if (!batchId) {
    return [row];
  }

  return yield* query((db) =>
    db
      .select()
      .from(plannedTransactions)
      .where(
        and(
          eq(plannedTransactions.batchId, batchId),
          isNull(plannedTransactions.deletedAt),
        ),
      )
      .for("update"),
  );
});

/** The primary leg drives generation: no batch, or the negative leg */
const primaryOf = (rows: Schedule[]): Schedule | undefined =>
  rows.length === 1 ? rows[0] : rows.find((row) => row.amount < 0);

/**
 * Idempotently inserts the missing occurrences of a schedule up to
 * min(endDate, today + 1 year). Hashes of occurrences that were submitted or
 * deleted count as present, so those never come back. An advisory lock keeps
 * concurrent runs (two cron processes, a save racing the cron) from
 * inserting the same occurrence twice. Runs inside the caller's transaction.
 */
export const generateOccurrences = Effect.fn("planned.generateOccurrences")(
  function* (primaryScheduleId: string, todayOverride?: string) {
    const today = todayOverride ?? (yield* todayInAppZone);

    yield* lockSchedule(primaryScheduleId);

    const legs = yield* loadScheduleBatch(primaryScheduleId);
    const primary = primaryOf(legs);

    if (!primary || primary.id !== primaryScheduleId) {
      return 0;
    }

    const dates = occurrenceDates(primary, today);

    if (dates.length === 0) {
      return 0;
    }

    const hashes = new Map(
      dates.map((date) => [occurrenceHash(date, primary.id), date]),
    );
    const existing = yield* query((db) =>
      db
        .select({ hash: transactions.plannedHash })
        .from(transactions)
        .where(
          and(
            eq(transactions.plannedTransactionId, primary.id),
            inArray(transactions.plannedHash, [...hashes.keys()]),
          ),
        ),
    );
    const present = new Set(existing.map((row) => row.hash));
    const ordered = [primary, ...legs.filter((leg) => leg.id !== primary.id)];
    let inserted = 0;

    for (const [hash, date] of hashes) {
      if (present.has(hash)) {
        continue;
      }

      const occurrenceLegs: Leg[] = ordered.map((leg) => ({
        kind: leg.kind,
        date,
        amount: leg.amount,
        accountId: leg.accountId,
        categoryId: leg.categoryId,
        counterpartyId: leg.counterpartyId,
        comment: leg.comment,
      }));

      yield* insertLegs(primary.createdBy, occurrenceLegs, {
        isPlanned: true,
        plannedTransactionId: primary.id,
        plannedHash: hash,
        audit: false,
      });
      inserted += 1;
    }

    return inserted;
  },
);

/** Inserts schedule legs (a pair shares a batchId) and returns the primary id */
const insertScheduleLegs = Effect.fnUntraced(function* (
  userId: string,
  legs: Leg[],
  schedule: ScheduleFields & {
    repeatType: Exclude<ScheduleFields["repeatType"], "none">;
  },
  startDate: string,
) {
  const batchId = legs.length > 1 ? newId() : null;
  const rows = yield* query((db) =>
    db
      .insert(plannedTransactions)
      .values(
        legs.map((leg) => ({
          batchId,
          kind: leg.kind,
          startDate,
          endDate: schedule.endDate,
          repeatType: schedule.repeatType,
          repeatInterval: schedule.repeatInterval,
          repeatWeekdays:
            schedule.repeatType === "weekly"
              ? [...new Set(schedule.repeatWeekdays)].sort()
              : [],
          amount: leg.amount,
          accountId: leg.accountId,
          categoryId: leg.categoryId,
          comment: leg.comment,
          counterpartyId: leg.counterpartyId,
          createdBy: userId,
        })),
      )
      .returning(),
  );

  const primary = primaryOf(rows);

  if (!primary) {
    return yield* Effect.die(
      new Error("Schedule insert returned no primary leg"),
    );
  }

  yield* audit({
    entityType: "schedule",
    entityId: rows.map((row) => row.id),
    action: "create",
    userId,
    payload: { legs, schedule, startDate },
  });

  return primary.id;
});

/**
 * Repeat "none": the transaction row(s) with isPlanned = true and no
 * schedule. Repeating: one schedule row per leg, then its occurrences, all
 * in one transaction.
 */
export const createPlanned = Effect.fn("planned.create")(function* (
  userId: string,
  input: { data: TransactionInput; schedule: ScheduleFields },
  today?: string,
) {
  const { legs } = yield* prepareLegs(userId, input.data);
  const { schedule } = input;

  if (schedule.repeatType === "none") {
    const result = yield* insertLegs(userId, legs, { isPlanned: true });

    return { ...result, scheduleId: null, occurrences: 1 };
  }

  const scheduleId = yield* insertScheduleLegs(
    userId,
    legs,
    { ...schedule, repeatType: schedule.repeatType },
    input.data.date,
  );
  const occurrences = yield* generateOccurrences(scheduleId, today);

  return { ids: [], batchId: null, scheduleId, occurrences };
}, transaction);

/** Generates missing occurrences for every live primary schedule (nightly) */
export const regenerateAll = Effect.fn("planned.regenerateAll")(function* (
  todayOverride?: string,
) {
  const today = todayOverride ?? (yield* todayInAppZone);
  const primaries = yield* query((db) =>
    db
      .select({ id: plannedTransactions.id })
      .from(plannedTransactions)
      .where(
        and(
          isNull(plannedTransactions.deletedAt),
          or(
            isNull(plannedTransactions.batchId),
            lt(plannedTransactions.amount, 0),
          ),
        ),
      ),
  );

  let occurrences = 0;

  for (const { id } of primaries) {
    // one transaction per schedule: a bad schedule can't block the rest
    occurrences += yield* transaction(generateOccurrences(id, today));
  }

  return { schedules: primaries.length, occurrences };
});

/** The live occurrence row and its pair, locked */
const loadOccurrence = Effect.fnUntraced(function* (id: string) {
  const [row] = yield* query((db) =>
    db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)))
      .for("update"),
  );

  if (!row) {
    return yield* notFound();
  }

  const batchId = row.batchId;
  const pair = batchId
    ? yield* query((db) =>
        db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.batchId, batchId),
              isNull(transactions.deletedAt),
            ),
          )
          .for("update"),
      )
    : [row];

  return { row, pair };
});

/**
 * "All planned" from an occurrence: delete it, the schedule and every
 * schedule in its batch, and every remaining un-submitted occurrence.
 * Already-submitted occurrences stay.
 */
export const deleteAllPlanned = Effect.fn("planned.deleteAll")(function* (
  userId: string,
  id: string,
) {
  const { row, pair } = yield* loadOccurrence(id);

  if (!row.isPlanned) {
    return yield* badRequest("not_planned");
  }

  if (!row.plannedTransactionId) {
    return yield* badRequest("not_recurring");
  }

  yield* requireDeletable(userId, pair);

  const scheduleLegs = yield* loadScheduleBatch(row.plannedTransactionId);
  const scheduleIds = scheduleLegs.map((leg) => leg.id);
  const at = yield* now;

  yield* query((db) =>
    db
      .update(plannedTransactions)
      .set({ deletedAt: at })
      .where(inArray(plannedTransactions.id, scheduleIds)),
  );

  const removed = yield* query((db) =>
    db
      .update(transactions)
      .set({ deletedAt: at })
      .where(
        and(
          isNull(transactions.deletedAt),
          or(
            inArray(
              transactions.id,
              pair.map((leg) => leg.id),
            ),
            and(
              eq(transactions.isPlanned, true),
              inArray(transactions.plannedTransactionId, scheduleIds),
            ),
          ),
        ),
      )
      .returning({ id: transactions.id }),
  );

  yield* audit({
    entityType: "schedule",
    entityId: scheduleIds,
    action: "delete",
    userId,
    payload: { fromOccurrence: id },
  });
  yield* audit({
    entityType: "transaction",
    entityId: removed.map((r) => r.id),
    action: "delete",
    userId,
    payload: { schedule: scheduleIds },
  });

  return { schedules: scheduleIds.length, occurrences: removed.length };
}, transaction);

/**
 * A schedule by either leg's id, for the edit-schedule form. The rights are
 * checked while the legs are still locked.
 */
export const getSchedule = Effect.fn("planned.getSchedule")(function* (
  userId: string,
  id: string,
) {
  const legs = yield* loadScheduleBatch(id);

  yield* requireDeletable(userId, legs);

  const primary = primaryOf(legs);

  if (!primary) {
    return yield* notFound();
  }

  return {
    id: primary.id,
    kind: primary.kind,
    startDate: primary.startDate,
    endDate: primary.endDate,
    repeatType: primary.repeatType,
    repeatInterval: primary.repeatInterval,
    repeatWeekdays: primary.repeatWeekdays,
  };
}, transaction);

/**
 * Edits a schedule: both legs change, every un-submitted occurrence dated
 * today or later is dropped and regenerated, overdue ones stay. The kind is
 * fixed.
 */
export const updateSchedule = Effect.fn("planned.updateSchedule")(function* (
  userId: string,
  input: {
    scheduleId: string;
    data: TransactionInput;
    schedule: ScheduleFields & {
      repeatType: Exclude<ScheduleFields["repeatType"], "none">;
    };
  },
  todayOverride?: string,
) {
  const today = todayOverride ?? (yield* todayInAppZone);
  const existing = yield* loadScheduleBatch(input.scheduleId);
  const primary = primaryOf(existing);

  if (!primary) {
    return yield* notFound();
  }

  yield* lockSchedule(primary.id);

  if (primary.kind !== input.data.kind) {
    return yield* badRequest("type_change_not_supported");
  }

  yield* requireDeletable(userId, existing);

  const { legs } = yield* prepareLegs(userId, input.data);

  if (existing.length !== legs.length) {
    return yield* badRequest("type_change_not_supported");
  }

  // occurrence hashes are keyed on the primary leg's id, so it must never
  // change: the new negative leg always goes onto the existing primary row
  const other = existing.find((row) => row.id !== primary.id);
  const primaryLeg = legs.find((leg) => leg.amount < 0) ?? legs[0];
  const otherLeg = legs.find((leg) => leg !== primaryLeg);
  const assignments = [
    { row: primary, leg: primaryLeg },
    ...(other && otherLeg ? [{ row: other, leg: otherLeg }] : []),
  ];
  const { schedule } = input;

  for (const { row, leg } of assignments) {
    if (!leg) {
      continue;
    }

    yield* query((db) =>
      db
        .update(plannedTransactions)
        .set({
          startDate: input.data.date,
          endDate: schedule.endDate,
          repeatType: schedule.repeatType,
          repeatInterval: schedule.repeatInterval,
          repeatWeekdays:
            schedule.repeatType === "weekly"
              ? [...new Set(schedule.repeatWeekdays)].sort()
              : [],
          amount: leg.amount,
          accountId: leg.accountId,
          categoryId: leg.categoryId,
          comment: leg.comment,
          counterpartyId: leg.counterpartyId,
        })
        .where(eq(plannedTransactions.id, row.id)),
    );
  }

  const primaryId = primary.id;
  const scheduleIds = existing.map((row) => row.id);
  const at = yield* now;

  // drop the future, un-submitted occurrences; clearing their hashes lets
  // regeneration recreate those dates under the new rules (occurrences the
  // user deleted one by one earlier keep their hash and stay gone)
  const dropped = yield* query((db) =>
    db
      .update(transactions)
      .set({ deletedAt: at, plannedHash: null })
      .where(
        and(
          isNull(transactions.deletedAt),
          eq(transactions.isPlanned, true),
          inArray(transactions.plannedTransactionId, scheduleIds),
          gte(transactions.date, today),
        ),
      )
      .returning({ id: transactions.id }),
  );

  yield* audit({
    entityType: "schedule",
    entityId: scheduleIds,
    action: "update",
    userId,
    payload: input,
  });

  const occurrences = yield* generateOccurrences(primaryId, today);

  return { scheduleId: primaryId, dropped: dropped.length, occurrences };
}, transaction);
