import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import { query } from "~/server/db/database";
import {
  accounts,
  budgets,
  categories,
  counterparties,
  currencies,
  historyLogs,
  plannedTransactions,
  transactions,
} from "~/server/db/schema";
import type { AuditEntity } from "~/server/lib/audit";

export const HISTORY_PAGE = 30;

const SHOWN = [
  "transaction",
  "schedule",
  "account",
  "category",
  "counterparty",
  "budget",
] as const satisfies readonly AuditEntity[];

type Shown = (typeof SHOWN)[number];

type Subject = { label: string | null; amount?: number; sign?: string };

const idsOf = (
  rows: readonly { entityType: string; entityId: string }[],
  type: Shown,
) => rows.filter((row) => row.entityType === type).map((row) => row.entityId);

/** What each logged id is called now, deleted or not */
const subjects = Effect.fnUntraced(function* (
  rows: readonly { entityType: string; entityId: string }[],
) {
  const [legs, schedules, accountRows, categoryRows, people, budgetRows] =
    yield* Effect.all(
      [
        query((db) =>
          db
            .select({
              id: transactions.id,
              comment: transactions.comment,
              amount: transactions.amount,
              batchId: transactions.batchId,
              category: categories.name,
              sign: currencies.sign,
            })
            .from(transactions)
            .innerJoin(accounts, eq(accounts.id, transactions.accountId))
            .innerJoin(currencies, eq(currencies.id, accounts.currencyId))
            .leftJoin(categories, eq(categories.id, transactions.categoryId))
            .where(inArray(transactions.id, idsOf(rows, "transaction"))),
        ),
        query((db) =>
          db
            .select({
              id: plannedTransactions.id,
              comment: plannedTransactions.comment,
            })
            .from(plannedTransactions)
            .where(inArray(plannedTransactions.id, idsOf(rows, "schedule"))),
        ),
        query((db) =>
          db
            .select({ id: accounts.id, name: accounts.name })
            .from(accounts)
            .where(inArray(accounts.id, idsOf(rows, "account"))),
        ),
        query((db) =>
          db
            .select({ id: categories.id, name: categories.name })
            .from(categories)
            .where(inArray(categories.id, idsOf(rows, "category"))),
        ),
        query((db) =>
          db
            .select({ id: counterparties.id, name: counterparties.name })
            .from(counterparties)
            .where(inArray(counterparties.id, idsOf(rows, "counterparty"))),
        ),
        query((db) =>
          db
            .select({ id: budgets.id, name: categories.name })
            .from(budgets)
            .innerJoin(categories, eq(categories.id, budgets.categoryId))
            .where(inArray(budgets.id, idsOf(rows, "budget"))),
        ),
      ],
      { concurrency: "unbounded" },
    );

  const found = new Map<string, Subject & { batched?: boolean }>();

  for (const leg of legs) {
    found.set(`transaction:${leg.id}`, {
      label: leg.comment ?? leg.category,
      amount: leg.amount,
      sign: leg.sign,
      batched: leg.batchId !== null,
    });
  }

  for (const row of schedules) {
    found.set(`schedule:${row.id}`, { label: row.comment });
  }

  for (const [type, list] of [
    ["account", accountRows],
    ["category", categoryRows],
    ["counterparty", people],
    ["budget", budgetRows],
  ] as const) {
    for (const row of list) {
      found.set(`${type}:${row.id}`, { label: row.name });
    }
  }

  return found;
});

/**
 * What the user changed, newest first. Rows written together are one entry
 * with a count, so an import reads as one line and a transfer's two legs as
 * one change.
 */
export const listHistory = Effect.fn("history.list")(function* (
  userId: string,
  offset: number,
) {
  const rows = yield* query((db) =>
    db
      .select({
        entityType: historyLogs.entityType,
        action: historyLogs.action,
        at: historyLogs.createdAt,
        entityId: sql<string>`min(${historyLogs.entityId})`,
        count: count(),
      })
      .from(historyLogs)
      .where(
        and(
          eq(historyLogs.userId, userId),
          inArray(historyLogs.entityType, SHOWN),
        ),
      )
      .groupBy(
        historyLogs.entityType,
        historyLogs.action,
        historyLogs.createdAt,
      )
      .orderBy(desc(historyLogs.createdAt), historyLogs.entityType)
      .limit(HISTORY_PAGE + 1)
      .offset(offset),
  );

  const page = rows.slice(0, HISTORY_PAGE);
  const names = yield* subjects(page);

  return {
    items: page.map((row) => {
      const subject = names.get(`${row.entityType}:${row.entityId}`);

      return {
        key: `${row.entityType}:${row.action}:${row.at.toISOString()}`,
        entityType: row.entityType as Shown,
        action: row.action,
        at: row.at,
        // a pair's two legs are one transaction
        count: subject?.batched && row.count === 2 ? 1 : row.count,
        label: subject?.label ?? null,
        amount: subject?.amount ?? null,
        sign: subject?.sign ?? null,
      };
    }),
    nextCursor: rows.length > HISTORY_PAGE ? offset + HISTORY_PAGE : null,
  };
});
