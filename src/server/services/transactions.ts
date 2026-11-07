import { and, eq, inArray, isNull, ne, sql, sum } from "drizzle-orm";
import { Effect } from "effect";

import type { TransactionInput } from "~/lib/validators/transactions";
import { type Database, query, transaction } from "~/server/db/database";
import {
  accounts,
  plannedTransactions,
  transactions,
} from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now } from "~/server/lib/clock";
import { badRequest, forbidden, notFound } from "~/server/lib/errors";
import { newId } from "~/server/lib/ids";
import {
  type AccountAccess,
  categoryAccess,
  requireWritableAccounts,
} from "~/server/services/access";
import { getOrCreateDebtAccount } from "~/server/services/accounts";
import { resolveCounterpartyRef } from "~/server/services/counterparties";

export type TransactionKind = TransactionInput["kind"];

/** One stored row of a transaction (a pair has two, sharing a batchId) */
export type Leg = {
  kind: TransactionKind;
  date: string;
  amount: number;
  accountId: string;
  categoryId: string | null;
  counterpartyId: string | null;
  comment: string | null;
};

/**
 * Validates an input against the integrity and permission rules and turns it
 * into its legs, in a fixed order: the first leg is the source (transfer) or
 * the real-account leg (debt); the second is the destination or the debt
 * account leg. Shared by transactions and schedules.
 *
 * Runs inside the caller's transaction: resolving the counterparty and the
 * debt account may insert rows.
 */
export const prepareLegs = Effect.fn("transactions.prepareLegs")(function* (
  userId: string,
  input: TransactionInput,
): Effect.fn.Return<
  { legs: Leg[]; access: Map<string, AccountAccess> },
  | Effect.Error<ReturnType<typeof requireWritableAccounts>>
  | Effect.Error<ReturnType<typeof resolveCounterpartyRef>>
  | Effect.Error<ReturnType<typeof getOrCreateDebtAccount>>,
  Database
> {
  const accountIds =
    input.kind === "transfer"
      ? [input.accountId, input.linkedAccountId]
      : [input.accountId];

  if (input.kind === "transfer" && input.accountId === input.linkedAccountId) {
    return yield* badRequest("fields_integrity_same_account_transfer");
  }

  const access = yield* requireWritableAccounts(userId, accountIds);

  // debt accounts are system-managed and never picked directly
  if (accountIds.some((id) => access.get(id)?.type === "debt")) {
    return yield* forbidden("account_is_debt");
  }

  const common = {
    kind: input.kind,
    date: input.date,
    comment: input.comment ?? null,
  };

  if (input.kind === "expense" || input.kind === "income") {
    if (input.categoryId) {
      const category = (yield* categoryAccess(userId, [input.categoryId])).get(
        input.categoryId,
      );

      if (!category?.canWrite) {
        return yield* forbidden();
      }

      if (input.kind === "expense" && !category.isExpense) {
        return yield* badRequest("fields_integrity_not_expense_category");
      }

      if (input.kind === "income" && !category.isIncome) {
        return yield* badRequest("fields_integrity_not_income_category");
      }
    }

    const counterpartyId = yield* resolveCounterpartyRef(
      userId,
      input.counterparty,
    );

    return {
      access,
      legs: [
        {
          ...common,
          amount: input.kind === "expense" ? -input.amount : input.amount,
          accountId: input.accountId,
          categoryId: input.categoryId,
          counterpartyId,
        },
      ],
    };
  }

  if (input.kind === "transfer") {
    return {
      access,
      legs: [
        {
          ...common,
          amount: -input.amount,
          accountId: input.accountId,
          categoryId: null,
          counterpartyId: null,
        },
        {
          ...common,
          amount: input.linkedAmount,
          accountId: input.linkedAccountId,
          categoryId: null,
          counterpartyId: null,
        },
      ],
    };
  }

  const counterpartyId = yield* resolveCounterpartyRef(
    userId,
    input.counterparty,
  );

  if (!counterpartyId) {
    return yield* badRequest("counterparty_required");
  }

  const account = access.get(input.accountId);
  const debtAccountId = yield* getOrCreateDebtAccount(
    userId,
    account?.currencyId ?? "",
  );
  const realAmount = input.direction === "gave" ? -input.amount : input.amount;

  return {
    access,
    legs: [
      {
        ...common,
        amount: realAmount,
        accountId: input.accountId,
        categoryId: null,
        counterpartyId,
      },
      {
        ...common,
        amount: -realAmount,
        accountId: debtAccountId,
        categoryId: null,
        counterpartyId,
      },
    ],
  };
});

export type CreateOptions = {
  isPlanned?: boolean;
  plannedTransactionId?: string | null;
  plannedHash?: string | null;
  importId?: string | null;
  createdAt?: Date;
  /** Generated occurrences are audited through their schedule instead */
  audit?: boolean;
};

/** Inserts prepared legs (a pair gets a fresh batchId) and audits them */
export const insertLegs = Effect.fn("transactions.insertLegs")(function* (
  userId: string,
  legs: readonly Leg[],
  options: CreateOptions = {},
) {
  const batchId = legs.length > 1 ? newId() : null;
  const rows = yield* query((db) =>
    db
      .insert(transactions)
      .values(
        legs.map((leg) => ({
          ...leg,
          batchId,
          isPlanned: options.isPlanned ?? false,
          plannedTransactionId: options.plannedTransactionId ?? null,
          plannedHash: options.plannedHash ?? null,
          importId: options.importId ?? null,
          createdBy: userId,
          ...(options.createdAt ? { createdAt: options.createdAt } : {}),
        })),
      )
      .returning({ id: transactions.id }),
  );

  const ids = rows.map((row) => row.id);

  if (options.audit !== false) {
    yield* audit({
      entityType: "transaction",
      entityId: ids,
      action: "create",
      userId,
      payload: { legs, ...options },
    });
  }

  return { ids, batchId };
});

/** Balances of the given accounts (non-debt only), for the negative warning */
export const balancesOf = Effect.fn("transactions.balancesOf")(function* (
  accountIds: readonly string[],
) {
  if (accountIds.length === 0) {
    return [];
  }

  return yield* query((db) =>
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        balance: sql<number>`${accounts.initialBalance} + coalesce((${db
          .select({ sum: sum(transactions.amount) })
          .from(transactions)
          .where(
            and(
              eq(transactions.accountId, accounts.id),
              isNull(transactions.deletedAt),
              eq(transactions.isPlanned, false),
            ),
          )}), 0)`.mapWith(Number),
      })
      .from(accounts)
      .where(
        and(inArray(accounts.id, [...accountIds]), ne(accounts.type, "debt")),
      ),
  );
});

export const createTransaction = Effect.fn("transactions.create")(function* (
  userId: string,
  input: TransactionInput,
  options: CreateOptions = {},
) {
  const { legs } = yield* prepareLegs(userId, input);
  const result = yield* insertLegs(userId, legs, options);
  const balances = yield* balancesOf(legs.map((leg) => leg.accountId));

  return { ...result, balances };
}, transaction);

/** The live row and every other live leg of its batch, locked */
const loadBatch = Effect.fnUntraced(function* (id: string) {
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

  if (!batchId) {
    return [row];
  }

  return yield* query((db) =>
    db
      .select()
      .from(transactions)
      .where(
        and(eq(transactions.batchId, batchId), isNull(transactions.deletedAt)),
      )
      .orderBy(transactions.amount)
      .for("update"),
  );
});

/**
 * Delete rights on existing rows: write access to every leg's account and,
 * where set, category.
 */
export const requireDeletable = Effect.fn("transactions.requireDeletable")(
  function* (
    userId: string,
    rows: readonly { accountId: string; categoryId: string | null }[],
  ) {
    yield* requireWritableAccounts(
      userId,
      rows.map((row) => row.accountId),
    );

    const categoryIds = rows
      .map((row) => row.categoryId)
      .filter((id): id is string => id !== null);
    const categories = yield* categoryAccess(userId, categoryIds);

    for (const categoryId of categoryIds) {
      if (!categories.get(categoryId)?.canWrite) {
        return yield* forbidden();
      }
    }
  },
);

/**
 * Orders the stored legs of a pair like prepareLegs does: the source or
 * real-account leg first, the destination or debt-account leg second.
 */
const orderStoredLegs = <T extends { accountId: string; amount: number }>(
  rows: readonly T[],
) =>
  Effect.gen(function* () {
    if (rows.length < 2) {
      return [...rows];
    }

    const debt = yield* query((db) =>
      db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            inArray(
              accounts.id,
              rows.map((row) => row.accountId),
            ),
            eq(accounts.type, "debt"),
          ),
        ),
    );
    const debtIds = new Set(debt.map((row) => row.id));

    if (debtIds.size > 0) {
      return [...rows].sort(
        (a, b) =>
          Number(debtIds.has(a.accountId)) - Number(debtIds.has(b.accountId)),
      );
    }

    return [...rows].sort((a, b) => a.amount - b.amount);
  });

/**
 * Updates both legs together. The kind can't change. Editing a planned
 * occurrence through here submits it (isPlanned = false, createdAt = now).
 */
export const updateTransaction = Effect.fn("transactions.update")(function* (
  userId: string,
  { id, data }: { id: string; data: TransactionInput },
) {
  const existing = yield* loadBatch(id);
  const first = existing[0];

  if (!first) {
    return yield* notFound();
  }

  if (first.kind !== data.kind) {
    return yield* badRequest("type_change_not_supported");
  }

  yield* requireDeletable(userId, existing);

  const { legs } = yield* prepareLegs(userId, data);
  const stored = yield* orderStoredLegs(existing);

  if (stored.length !== legs.length) {
    return yield* badRequest("type_change_not_supported");
  }

  const submitting = first.isPlanned;
  const at = yield* now;

  for (const [index, row] of stored.entries()) {
    const leg = legs[index];

    if (!leg) {
      continue;
    }

    yield* query((db) =>
      db
        .update(transactions)
        .set({
          ...leg,
          ...(submitting ? { isPlanned: false, createdAt: at } : {}),
        })
        .where(eq(transactions.id, row.id)),
    );
  }

  yield* audit({
    entityType: "transaction",
    entityId: stored.map((row) => row.id),
    action: "update",
    userId,
    payload: { data, submitted: submitting },
  });

  const balances = yield* balancesOf(legs.map((leg) => leg.accountId));

  return {
    ids: stored.map((row) => row.id),
    submitted: submitting,
    balances,
  };
}, transaction);

/** Soft-deletes the row and every other live leg of its batch */
export const deleteTransaction = Effect.fn("transactions.delete")(function* (
  userId: string,
  id: string,
) {
  const existing = yield* loadBatch(id);

  yield* requireDeletable(userId, existing);

  const ids = existing.map((row) => row.id);
  const at = yield* now;

  yield* query((db) =>
    db
      .update(transactions)
      .set({ deletedAt: at })
      .where(inArray(transactions.id, ids)),
  );

  yield* audit({
    entityType: "transaction",
    entityId: ids,
    action: "delete",
    userId,
    payload: { id },
  });

  return { ids };
}, transaction);

/**
 * Confirms a planned transaction exactly as planned, every leg at once, so a
 * bill that went out as expected takes one tap instead of a form. Keeps the
 * row's date. A row already submitted changes nothing, so a repeat is harmless.
 */
export const submitPlanned = Effect.fn("transactions.submitPlanned")(function* (
  userId: string,
  id: string,
) {
  const existing = yield* loadBatch(id);

  if (!existing[0]?.isPlanned) {
    return { ids: [] };
  }

  yield* requireDeletable(userId, existing);

  const ids = existing.map((row) => row.id);
  const at = yield* now;

  yield* query((db) =>
    db
      .update(transactions)
      .set({ isPlanned: false, createdAt: at })
      .where(inArray(transactions.id, ids)),
  );

  yield* audit({
    entityType: "transaction",
    entityId: ids,
    action: "update",
    userId,
    payload: { id, submitted: true },
  });

  return { ids };
}, transaction);

/** The Undo of `submitPlanned`: the row goes back to waiting */
export const unsubmitPlanned = Effect.fn("transactions.unsubmitPlanned")(
  function* (userId: string, id: string) {
    const existing = yield* loadBatch(id);

    if (existing[0]?.isPlanned !== false) {
      return { ids: [] };
    }

    yield* requireDeletable(userId, existing);

    const ids = existing.map((row) => row.id);

    yield* query((db) =>
      db
        .update(transactions)
        .set({ isPlanned: true })
        .where(inArray(transactions.id, ids)),
    );

    yield* audit({
      entityType: "transaction",
      entityId: ids,
      action: "update",
      userId,
      payload: { id, submitted: false },
    });

    return { ids };
  },
  transaction,
);

/**
 * Undoes a delete: the row and the legs that went with it, recognised by the
 * same `deletedAt`, so a leg removed some other time stays gone. The rights
 * are those of the delete, which also refuses a deleted account or category.
 * Restoring a live row changes nothing, so a repeated Undo is harmless.
 */
export const restoreTransaction = Effect.fn("transactions.restore")(function* (
  userId: string,
  id: string,
) {
  const [row] = yield* query((db) =>
    db.select().from(transactions).where(eq(transactions.id, id)).for("update"),
  );

  if (!row) {
    return yield* notFound();
  }

  const { batchId, deletedAt, plannedTransactionId } = row;

  if (!deletedAt) {
    return { ids: [] };
  }

  const rows = batchId
    ? yield* query((db) =>
        db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.batchId, batchId),
              eq(transactions.deletedAt, deletedAt),
            ),
          )
          .for("update"),
      )
    : [row];

  yield* requireDeletable(userId, rows);

  if (plannedTransactionId) {
    const [schedule] = yield* query((db) =>
      db
        .select({ id: plannedTransactions.id })
        .from(plannedTransactions)
        .where(
          and(
            eq(plannedTransactions.id, plannedTransactionId),
            isNull(plannedTransactions.deletedAt),
          ),
        ),
    );

    // nothing would drive or edit the occurrence any more
    if (!schedule) {
      return yield* notFound();
    }
  }

  const ids = rows.map((leg) => leg.id);

  yield* query((db) =>
    db
      .update(transactions)
      .set({ deletedAt: null })
      .where(inArray(transactions.id, ids)),
  );

  yield* audit({
    entityType: "transaction",
    entityId: ids,
    action: "restore",
    userId,
    payload: { id },
  });

  return { ids };
}, transaction);
