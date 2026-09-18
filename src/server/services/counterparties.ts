import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { DbOrTx } from "~/server/db";
import {
  accountMembers,
  accounts,
  counterparties,
  currencies,
  plannedTransactions,
  transactions,
} from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { appError, isUniqueViolation, notFound } from "~/server/lib/errors";
import { newId } from "~/server/lib/ids";

/** Trims and collapses inner whitespace, so "  Alex   K " matches "Alex K" */
export const normalizeCounterpartyName = (name: string): string =>
  name.trim().replace(/\s+/g, " ");

/**
 * Create-or-match by name, case-insensitively, among the owner's live
 * counterparties. The insert races safely on the partial unique index.
 */
export const resolveCounterparty = async (
  tx: DbOrTx,
  ownerId: string,
  rawName: string,
): Promise<string> => {
  const name = normalizeCounterpartyName(rawName).slice(0, 255);

  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO ${counterparties} (id, owner_id, name)
    VALUES (${newId()}, ${ownerId}, ${name})
    ON CONFLICT (owner_id, lower(name)) WHERE deleted_at IS NULL DO NOTHING
    RETURNING id
  `);

  const created = [...inserted][0];

  if (created) {
    return created.id;
  }

  const [existing] = await tx
    .select({ id: counterparties.id })
    .from(counterparties)
    .where(
      and(
        eq(counterparties.ownerId, ownerId),
        sql`lower(${counterparties.name}) = lower(${name})`,
        isNull(counterparties.deletedAt),
      ),
    );

  if (!existing) {
    throw new Error("Counterparty vanished between insert and select");
  }

  return existing.id;
};

/**
 * A counterparty reference from a form: an existing id the user owns, or a
 * new name to create-or-match. Returns null when neither is given.
 */
export const resolveCounterpartyRef = async (
  tx: DbOrTx,
  ownerId: string,
  ref: { id?: string | null; name?: string | null } | null | undefined,
): Promise<string | null> => {
  if (ref?.id) {
    const [row] = await tx
      .select({ id: counterparties.id })
      .from(counterparties)
      .where(
        and(
          eq(counterparties.id, ref.id),
          eq(counterparties.ownerId, ownerId),
          isNull(counterparties.deletedAt),
        ),
      );

    if (!row) {
      throw appError("BAD_REQUEST", "forbidden");
    }

    return row.id;
  }

  const name = ref?.name ? normalizeCounterpartyName(ref.name) : "";

  return name ? resolveCounterparty(tx, ownerId, name) : null;
};

/**
 * Debt balances per (counterparty, currency) over the user's readable debt
 * accounts: submitted, live rows only. Positive means they owe me. Ordered by
 * sum descending.
 */
export const counterpartyBalances = async (db: DbOrTx, userId: string) => {
  const rows = await db
    .select({
      counterpartyId: transactions.counterpartyId,
      counterpartyName: counterparties.name,
      currencyId: accounts.currencyId,
      currencyCode: currencies.code,
      currencySign: currencies.sign,
      sum: sql<number>`sum(${transactions.amount})`.mapWith(Number),
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
      sql`sum(${transactions.amount}) DESC`,
      asc(counterparties.name),
      asc(currencies.code),
    );

  return rows.filter((row) => row.sum !== 0);
};

/** The user's own counterparties, for the combobox and management view */
export const listCounterparties = async (db: DbOrTx, userId: string) => {
  const rows = await db
    .select({
      id: counterparties.id,
      name: counterparties.name,
      usage: sql<number>`(
        SELECT count(*) FROM ${transactions} t
        WHERE t.counterparty_id = "counterparties"."id" AND t.deleted_at IS NULL
      )`.mapWith(Number),
    })
    .from(counterparties)
    .where(
      and(eq(counterparties.ownerId, userId), isNull(counterparties.deletedAt)),
    )
    .orderBy(sql`lower(${counterparties.name})`, asc(counterparties.id));

  const balances = await counterpartyBalances(db, userId);

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
};

const requireOwned = async (db: DbOrTx, userId: string, id: string) => {
  const [row] = await db
    .select()
    .from(counterparties)
    .where(
      and(
        eq(counterparties.id, id),
        eq(counterparties.ownerId, userId),
        isNull(counterparties.deletedAt),
      ),
    )
    .for("update");

  if (!row) {
    throw notFound();
  }

  return row;
};

export const renameCounterparty = async (
  db: DbOrTx,
  userId: string,
  input: { id: string; name: string },
) => {
  const name = normalizeCounterpartyName(input.name);

  try {
    return await db.transaction(async (tx) => {
      await requireOwned(tx, userId, input.id);

      const [row] = await tx
        .update(counterparties)
        .set({ name })
        .where(eq(counterparties.id, input.id))
        .returning();

      await audit(tx, {
        entityType: "counterparty",
        entityId: input.id,
        action: "update",
        userId,
        payload: { name },
      });

      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error, "counterparties_owner_name_live_uq")) {
      throw appError("BAD_REQUEST", "counterparty_name_not_unique", error);
    }

    throw error;
  }
};

/**
 * Repoints every transaction and schedule from `sourceId` to `targetId`, then
 * soft-deletes the source.
 */
export const mergeCounterparties = (
  db: DbOrTx,
  userId: string,
  input: { sourceId: string; targetId: string },
) =>
  db.transaction(async (tx) => {
    if (input.sourceId === input.targetId) {
      throw appError("BAD_REQUEST", "counterparty_merge_self");
    }

    // lock both in id order, so two opposite merges can't deadlock
    for (const id of [input.sourceId, input.targetId].sort()) {
      await requireOwned(tx, userId, id);
    }

    const moved = await tx
      .update(transactions)
      .set({ counterpartyId: input.targetId })
      .where(eq(transactions.counterpartyId, input.sourceId))
      .returning({ id: transactions.id });

    await tx
      .update(plannedTransactions)
      .set({ counterpartyId: input.targetId })
      .where(eq(plannedTransactions.counterpartyId, input.sourceId));

    await tx
      .update(counterparties)
      .set({ deletedAt: new Date() })
      .where(eq(counterparties.id, input.sourceId));

    await audit(tx, {
      entityType: "counterparty",
      entityId: input.sourceId,
      action: "delete",
      userId,
      payload: { mergedInto: input.targetId, transactions: moved.length },
    });

    return { moved: moved.length };
  });

/** Soft delete, only while no live transaction or schedule uses it */
export const deleteCounterparty = (db: DbOrTx, userId: string, id: string) =>
  db.transaction(async (tx) => {
    await requireOwned(tx, userId, id);

    const [row] = await tx.execute<{ used: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM ${transactions}
        WHERE ${transactions.counterpartyId} = ${id} AND ${transactions.deletedAt} IS NULL
      ) OR EXISTS (
        SELECT 1 FROM ${plannedTransactions}
        WHERE ${plannedTransactions.counterpartyId} = ${id}
          AND ${plannedTransactions.deletedAt} IS NULL
      ) AS used
    `);

    if (row?.used) {
      throw appError("BAD_REQUEST", "counterparty_in_use");
    }

    await tx
      .update(counterparties)
      .set({ deletedAt: new Date() })
      .where(eq(counterparties.id, id));

    await audit(tx, {
      entityType: "counterparty",
      entityId: id,
      action: "delete",
      userId,
      payload: { id },
    });
  });
