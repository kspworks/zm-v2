import { and, asc, desc, eq, isNull, sql, sum } from "drizzle-orm";
import { Effect } from "effect";

import { catchUniqueViolation, query, transaction } from "~/server/db/database";
import {
  accountMembers,
  accounts,
  counterparties,
  currencies,
  plannedTransactions,
  transactions,
} from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now } from "~/server/lib/clock";
import { badRequest, forbidden, notFound } from "~/server/lib/errors";
import { newId } from "~/server/lib/ids";

/** Trims and collapses inner whitespace, so "  Alex   K " matches "Alex K" */
export const normalizeCounterpartyName = (name: string): string =>
  name.trim().replace(/\s+/g, " ");

/**
 * Create-or-match by name, case-insensitively, among the owner's live
 * counterparties. The insert races safely on the partial unique index.
 */
export const resolveCounterparty = Effect.fn("counterparties.resolve")(
  function* (ownerId: string, rawName: string) {
    const name = normalizeCounterpartyName(rawName).slice(0, 255);

    // untargeted: the builder can't name the lower(name) index, and the only
    // other unique constraint is the fresh primary key
    const [created] = yield* query((db) =>
      db
        .insert(counterparties)
        .values({ id: newId(), ownerId, name })
        .onConflictDoNothing()
        .returning({ id: counterparties.id }),
    );

    if (created) {
      return created.id;
    }

    const [existing] = yield* query((db) =>
      db
        .select({ id: counterparties.id })
        .from(counterparties)
        .where(
          and(
            eq(counterparties.ownerId, ownerId),
            sql`lower(${counterparties.name}) = lower(${name})`,
            isNull(counterparties.deletedAt),
          ),
        ),
    );

    if (!existing) {
      return yield* Effect.die(
        new Error("Counterparty vanished between insert and select"),
      );
    }

    return existing.id;
  },
);

/**
 * A counterparty reference from a form: an existing id the user owns, or a
 * new name to create-or-match. Returns null when neither is given.
 */
export const resolveCounterpartyRef = Effect.fn("counterparties.resolveRef")(
  function* (
    ownerId: string,
    ref: { id?: string | null; name?: string | null } | null | undefined,
  ) {
    if (ref?.id) {
      const refId = ref.id;
      const [row] = yield* query((db) =>
        db
          .select({ id: counterparties.id })
          .from(counterparties)
          .where(
            and(
              eq(counterparties.id, refId),
              eq(counterparties.ownerId, ownerId),
              isNull(counterparties.deletedAt),
            ),
          ),
      );

      if (!row) {
        return yield* forbidden();
      }

      return row.id;
    }

    const name = ref?.name ? normalizeCounterpartyName(ref.name) : "";

    return name ? yield* resolveCounterparty(ownerId, name) : null;
  },
);

/**
 * Debt balances per (counterparty, currency) over the user's readable debt
 * accounts: submitted, live rows only. Positive means they owe me. Ordered by
 * sum descending.
 */
export const counterpartyBalances = Effect.fn("counterparties.balances")(
  function* (userId: string) {
    const rows = yield* query((db) =>
      db
        .select({
          counterpartyId: transactions.counterpartyId,
          counterpartyName: counterparties.name,
          currencyId: accounts.currencyId,
          currencyCode: currencies.code,
          currencySign: currencies.sign,
          sum: sum(transactions.amount).mapWith(Number),
        })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .innerJoin(
          accountMembers,
          and(
            eq(accountMembers.accountId, accounts.id),
            eq(accountMembers.userId, userId),
            isNull(accountMembers.deletedAt),
            eq(accountMembers.canRead, true),
          ),
        )
        .innerJoin(currencies, eq(currencies.id, accounts.currencyId))
        .leftJoin(
          counterparties,
          eq(counterparties.id, transactions.counterpartyId),
        )
        .where(
          and(
            eq(accounts.type, "debt"),
            isNull(accounts.deletedAt),
            isNull(transactions.deletedAt),
            eq(transactions.isPlanned, false),
          ),
        )
        .groupBy(
          transactions.counterpartyId,
          counterparties.name,
          accounts.currencyId,
          currencies.code,
          currencies.sign,
        )
        .orderBy(
          desc(sum(transactions.amount)),
          asc(counterparties.name),
          asc(currencies.code),
        ),
    );

    return rows.filter((row) => row.sum !== 0);
  },
);

/** The user's own counterparties, for the combobox and management view */
export const listCounterparties = Effect.fn("counterparties.list")(function* (
  userId: string,
) {
  const rows = yield* query((db) =>
    db
      .select({
        id: counterparties.id,
        name: counterparties.name,
        usage: db.$count(
          transactions,
          and(
            eq(transactions.counterpartyId, counterparties.id),
            isNull(transactions.deletedAt),
          ),
        ),
      })
      .from(counterparties)
      .where(
        and(
          eq(counterparties.ownerId, userId),
          isNull(counterparties.deletedAt),
        ),
      )
      .orderBy(sql`lower(${counterparties.name})`, asc(counterparties.id)),
  );

  const balances = yield* counterpartyBalances(userId);

  return rows.map((row) => ({
    ...row,
    balances: balances
      .filter((balance) => balance.counterpartyId === row.id)
      .map(({ currencyId, currencyCode, currencySign, sum }) => ({
        currencyId,
        currencyCode,
        currencySign,
        sum,
      })),
  }));
});

const requireOwned = Effect.fnUntraced(function* (userId: string, id: string) {
  const [row] = yield* query((db) =>
    db
      .select()
      .from(counterparties)
      .where(
        and(
          eq(counterparties.id, id),
          eq(counterparties.ownerId, userId),
          isNull(counterparties.deletedAt),
        ),
      )
      .for("update"),
  );

  if (!row) {
    return yield* notFound();
  }

  return row;
});

export const renameCounterparty = Effect.fn("counterparties.rename")(
  function* (userId: string, input: { id: string; name: string }) {
    const name = normalizeCounterpartyName(input.name);

    yield* requireOwned(userId, input.id);

    const [row] = yield* query((db) =>
      db
        .update(counterparties)
        .set({ name })
        .where(eq(counterparties.id, input.id))
        .returning(),
    );

    yield* audit({
      entityType: "counterparty",
      entityId: input.id,
      action: "update",
      userId,
      payload: { name },
    });

    return row;
  },
  transaction,
  catchUniqueViolation("counterparties_owner_name_live_uq", () =>
    badRequest("counterparty_name_not_unique"),
  ),
);

/**
 * Repoints every transaction and schedule from `sourceId` to `targetId`, then
 * soft-deletes the source.
 */
export const mergeCounterparties = Effect.fn("counterparties.merge")(function* (
  userId: string,
  input: { sourceId: string; targetId: string },
) {
  if (input.sourceId === input.targetId) {
    return yield* badRequest("counterparty_merge_self");
  }

  // lock both in id order, so two opposite merges can't deadlock
  for (const id of [input.sourceId, input.targetId].sort()) {
    yield* requireOwned(userId, id);
  }

  const moved = yield* query((db) =>
    db
      .update(transactions)
      .set({ counterpartyId: input.targetId })
      .where(eq(transactions.counterpartyId, input.sourceId))
      .returning({ id: transactions.id }),
  );

  yield* query((db) =>
    db
      .update(plannedTransactions)
      .set({ counterpartyId: input.targetId })
      .where(eq(plannedTransactions.counterpartyId, input.sourceId)),
  );

  const at = yield* now;

  yield* query((db) =>
    db
      .update(counterparties)
      .set({ deletedAt: at })
      .where(eq(counterparties.id, input.sourceId)),
  );

  yield* audit({
    entityType: "counterparty",
    entityId: input.sourceId,
    action: "delete",
    userId,
    payload: { mergedInto: input.targetId, transactions: moved.length },
  });

  return { moved: moved.length };
}, transaction);

/** Any live transaction (submitted or planned) or live schedule */
const counterpartyInUse = Effect.fnUntraced(function* (id: string) {
  const [row] = yield* query((db) =>
    db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.counterpartyId, id),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1),
  );

  if (row) {
    return true;
  }

  const [schedule] = yield* query((db) =>
    db
      .select({ id: plannedTransactions.id })
      .from(plannedTransactions)
      .where(
        and(
          eq(plannedTransactions.counterpartyId, id),
          isNull(plannedTransactions.deletedAt),
        ),
      )
      .limit(1),
  );

  return schedule !== undefined;
});

/** Soft delete, only while no live transaction or schedule uses it */
export const deleteCounterparty = Effect.fn("counterparties.delete")(function* (
  userId: string,
  id: string,
) {
  yield* requireOwned(userId, id);

  if (yield* counterpartyInUse(id)) {
    return yield* badRequest("counterparty_in_use");
  }

  const at = yield* now;

  yield* query((db) =>
    db
      .update(counterparties)
      .set({ deletedAt: at })
      .where(eq(counterparties.id, id)),
  );

  yield* audit({
    entityType: "counterparty",
    entityId: id,
    action: "delete",
    userId,
    payload: { id },
  });
}, transaction);
