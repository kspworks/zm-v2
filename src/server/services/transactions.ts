import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { TransactionInput } from "~/lib/validators/transactions";
import type { DbOrTx } from "~/server/db";
import { accounts, transactions } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { appError, forbidden, notFound } from "~/server/lib/errors";
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
export const prepareLegs = async (
  tx: DbOrTx,
  userId: string,
  input: TransactionInput,
): Promise<{ legs: Leg[]; access: Map<string, AccountAccess> }> => {
  const accountIds =
    input.kind === "transfer"
      ? [input.accountId, input.linkedAccountId]
      : [input.accountId];

  if (input.kind === "transfer" && input.accountId === input.linkedAccountId) {
    throw appError("BAD_REQUEST", "fields_integrity_same_account_transfer");
  }

  const access = await requireWritableAccounts(tx, userId, accountIds);

  // debt accounts are system-managed and never picked directly
  if (accountIds.some((id) => access.get(id)?.type === "debt")) {
    throw forbidden("account_is_debt");
  }

  const common = {
    kind: input.kind,
    date: input.date,
    comment: input.comment ?? null,
  };

  if (input.kind === "expense" || input.kind === "income") {
    if (input.categoryId) {
      const category = (
        await categoryAccess(tx, userId, [input.categoryId])
      ).get(input.categoryId);

      if (!category?.canWrite) {
        throw forbidden();
      }

      if (input.kind === "expense" && !category.isExpense) {
        throw appError("BAD_REQUEST", "fields_integrity_not_expense_category");
      }

      if (input.kind === "income" && !category.isIncome) {
        throw appError("BAD_REQUEST", "fields_integrity_not_income_category");
      }
    }

    const counterpartyId = await resolveCounterpartyRef(
      tx,
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

  const counterpartyId = await resolveCounterpartyRef(
    tx,
    userId,
    input.counterparty,
  );

  if (!counterpartyId) {
    throw appError("BAD_REQUEST", "counterparty_required");
  }

  const account = access.get(input.accountId);
  const debtAccountId = await getOrCreateDebtAccount(
    tx,
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
};

export type CreateOptions = {
  isPlanned?: boolean;
  plannedTransactionId?: string | null;
  plannedHash?: string | null;
  importId?: string | null;
  createdAt?: Date;
};

/** Inserts prepared legs (a pair gets a fresh batchId) and audits them */
export const insertLegs = async (
  tx: DbOrTx,
  userId: string,
  legs: Leg[],
  options: CreateOptions = {},
): Promise<{ ids: string[]; batchId: string | null }> => {
  const batchId = legs.length > 1 ? newId() : null;
  const rows = await tx
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
    .returning({ id: transactions.id });

  const ids = rows.map((row) => row.id);

  await audit(tx, {
    entityType: "transaction",
    entityId: ids,
    action: "create",
    userId,
    payload: { legs, ...options },
  });

  return { ids, batchId };
};

/** Balances of the given accounts (non-debt only), for the negative warning */
export const balancesOf = async (db: DbOrTx, accountIds: string[]) => {
  if (accountIds.length === 0) {
    return [];
  }

  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      balance: sql<number>`${accounts.initialBalance} + coalesce((
        SELECT sum(t.amount) FROM ${transactions} t
        WHERE t.account_id = "accounts"."id"
          AND t.deleted_at IS NULL AND NOT t.is_planned
      ), 0)`.mapWith(Number),
    })
    .from(accounts)
    .where(
      and(inArray(accounts.id, accountIds), sql`${accounts.type} <> 'debt'`),
    );
};

export const createTransaction = (
  db: DbOrTx,
  userId: string,
  input: TransactionInput,
  options: CreateOptions = {},
) =>
  db.transaction(async (tx) => {
    const { legs } = await prepareLegs(tx, userId, input);
    const result = await insertLegs(tx, userId, legs, options);
    const balances = await balancesOf(
      tx,
      legs.map((leg) => leg.accountId),
    );

    return { ...result, balances };
  });

/** The live row and every other live leg of its batch, locked */
const loadBatch = async (tx: DbOrTx, id: string) => {
  const [row] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)))
    .for("update");

  if (!row) {
    throw notFound();
  }

  if (!row.batchId) {
    return [row];
  }

  return tx
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.batchId, row.batchId),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(transactions.amount)
    .for("update");
};

/**
 * Delete rights on existing rows: write access to every leg's account and,
 * where set, category.
 */
const requireDeletable = async (
  tx: DbOrTx,
  userId: string,
  rows: { accountId: string; categoryId: string | null }[],
) => {
  await requireWritableAccounts(
    tx,
    userId,
    rows.map((row) => row.accountId),
  );

  const categoryIds = rows
    .map((row) => row.categoryId)
    .filter((id): id is string => id !== null);
  const categories = await categoryAccess(tx, userId, categoryIds);

  for (const categoryId of categoryIds) {
    if (!categories.get(categoryId)?.canWrite) {
      throw forbidden();
    }
  }
};

/**
 * Orders the stored legs of a pair like prepareLegs does: the source or
 * real-account leg first, the destination or debt-account leg second.
 */
const orderStoredLegs = async <T extends { accountId: string; amount: number }>(
  tx: DbOrTx,
  rows: T[],
): Promise<T[]> => {
  if (rows.length < 2) {
    return rows;
  }

  const debt = await tx
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
    );
  const debtIds = new Set(debt.map((row) => row.id));

  if (debtIds.size > 0) {
    return [...rows].sort(
      (a, b) =>
        Number(debtIds.has(a.accountId)) - Number(debtIds.has(b.accountId)),
    );
  }

  return [...rows].sort((a, b) => a.amount - b.amount);
};

/**
 * Updates both legs together. The kind can't change. Editing a planned
 * occurrence through here submits it (isPlanned = false, createdAt = now).
 */
export const updateTransaction = (
  db: DbOrTx,
  userId: string,
  { id, data }: { id: string; data: TransactionInput },
) =>
  db.transaction(async (tx) => {
    const existing = await loadBatch(tx, id);
    const first = existing[0];

    if (!first) {
      throw notFound();
    }

    if (first.kind !== data.kind) {
      throw appError("BAD_REQUEST", "type_change_not_supported");
    }

    await requireDeletable(tx, userId, existing);

    const { legs } = await prepareLegs(tx, userId, data);
    const stored = await orderStoredLegs(tx, existing);

    if (stored.length !== legs.length) {
      throw appError("BAD_REQUEST", "type_change_not_supported");
    }

    const submitting = first.isPlanned;

    for (const [index, row] of stored.entries()) {
      const leg = legs[index];

      if (!leg) {
        continue;
      }

      await tx
        .update(transactions)
        .set({
          ...leg,
          ...(submitting ? { isPlanned: false, createdAt: new Date() } : {}),
        })
        .where(eq(transactions.id, row.id));
    }

    await audit(tx, {
      entityType: "transaction",
      entityId: stored.map((row) => row.id),
      action: "update",
      userId,
      payload: { data, submitted: submitting },
    });

    const balances = await balancesOf(
      tx,
      legs.map((leg) => leg.accountId),
    );

    return {
      ids: stored.map((row) => row.id),
      submitted: submitting,
      balances,
    };
  });

/** Soft-deletes the row and every other live leg of its batch */
export const deleteTransaction = (db: DbOrTx, userId: string, id: string) =>
  db.transaction(async (tx) => {
    const existing = await loadBatch(tx, id);

    await requireDeletable(tx, userId, existing);

    const ids = existing.map((row) => row.id);

    await tx
      .update(transactions)
      .set({ deletedAt: new Date() })
      .where(inArray(transactions.id, ids));

    await audit(tx, {
      entityType: "transaction",
      entityId: ids,
      action: "delete",
      userId,
      payload: { id },
    });

    return { ids };
  });
