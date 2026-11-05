import { addDays, format, parseISO } from "date-fns";
import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { Effect } from "effect";

import {
  type BalancePoint,
  buildBalanceSeries,
  buildForecast,
  type DashboardEntry,
  effectiveDate,
  type ForecastMonth,
  forecastWindow,
  NEAREST_DAYS,
} from "~/lib/dashboard";
import { type Database, query, type SqlError } from "~/server/db/database";
import { accounts, transactions } from "~/server/db/schema";
import type { AppConfig } from "~/server/effect/app-config";
import { today as todayInAppZone } from "~/server/lib/clock";
import { readableAccounts } from "~/server/services/accounts";
import {
  type DashboardPairRow,
  dashboardPairs,
  nearestPlannedDates,
} from "~/server/services/transaction-queries";

type ScopeInput = {
  currencyId: string;
  /** Narrows the scope; omitted means every account in it */
  accountIds?: readonly string[];
  /** `false` leaves debt pairs out; omitted, they count */
  includeDebts?: boolean;
};

/**
 * The balance scope, matching the sidebar's "Available": readable, active,
 * non-debt accounts in one currency, narrowed to `accountIds` when given.
 * IDs outside that set are ignored.
 */
const scopeAccounts = Effect.fnUntraced(function* (
  userId: string,
  { currencyId, accountIds }: ScopeInput,
) {
  if (accountIds?.length === 0) {
    return { ids: [], initial: 0 };
  }

  const rows = yield* query((db) =>
    readableAccounts(
      db,
      userId,
      and(
        eq(accounts.currencyId, currencyId),
        eq(accounts.isActive, true),
        ne(accounts.type, "debt"),
        accountIds ? inArray(accounts.id, accountIds) : undefined,
      ),
    ),
  );

  return {
    ids: rows.map((row) => row.id),
    initial: rows.reduce((sum, row) => sum + row.initialBalance, 0),
  };
});

/** Initial balances plus every submitted leg on the accounts before `date` */
const balanceBefore = Effect.fnUntraced(function* (
  scope: { ids: string[]; initial: number },
  date: string,
) {
  if (scope.ids.length === 0) {
    return 0;
  }

  const [row] = yield* query((db) =>
    db
      .select({
        sum: sql<number>`coalesce(sum(${transactions.amount}), 0)`.mapWith(
          Number,
        ),
      })
      .from(transactions)
      .where(
        and(
          inArray(transactions.accountId, scope.ids),
          isNull(transactions.deletedAt),
          eq(transactions.isPlanned, false),
          lt(transactions.date, date),
        ),
      ),
  );

  return scope.initial + (row?.sum ?? 0);
});

const categoryLabel = (row: DashboardPairRow) =>
  row.categoryName
    ? row.categoryParentName
      ? `${row.categoryParentName} → ${row.categoryName}`
      : row.categoryName
    : null;

const toEntry = (row: DashboardPairRow, net: number): DashboardEntry => {
  const isTransfer = row.kind === "transfer";

  return {
    id: row.id,
    kind: row.kind,
    date: row.date,
    planned: row.isPlanned,
    net,
    category: categoryLabel(row),
    comment: row.comment,
    counterparty: row.counterpartyName,
    fromAccount: isTransfer ? row.accountName : null,
    toAccount: isTransfer ? row.linkedAccountName : null,
  };
};

/** Each pair's net effect on the account set: the sum of its legs on it */
const netEntries = (
  rows: DashboardPairRow[],
  ids: string[],
): DashboardEntry[] => {
  const scope = new Set(ids);

  return rows.map((row) =>
    toEntry(
      row,
      (scope.has(row.accountId) ? row.amount : 0) +
        (row.linkedAccountId && scope.has(row.linkedAccountId)
          ? (row.linkedAmount ?? 0)
          : 0),
    ),
  );
};

/** Submitted pairs in [start, end] plus planned pairs up to end (overdue too) */
const windowEntries = Effect.fnUntraced(function* (
  userId: string,
  ids: string[],
  start: string,
  end: string,
  includeDebts = true,
) {
  if (ids.length === 0) {
    return [];
  }

  const [submitted, planned] = yield* Effect.all(
    [
      dashboardPairs(userId, "submitted", {
        accountIds: ids,
        startDate: start,
        endDate: end,
      }),
      dashboardPairs(userId, "planned", { accountIds: ids, endDate: end }),
    ],
    { concurrency: "unbounded" },
  );

  const entries = netEntries([...submitted, ...planned], ids);

  return includeDebts
    ? entries
    : entries.filter((entry) => entry.kind !== "debt");
});

const shift = (date: string, days: number) =>
  format(addDays(parseISO(date), days), "yyyy-MM-dd");

export const balanceSeries = Effect.fn("dashboard.balanceSeries")(function* (
  userId: string,
  input: ScopeInput & { back: number; ahead: number },
  todayOverride?: string,
): Effect.fn.Return<BalancePoint[], SqlError, Database | AppConfig> {
  const today = todayOverride ?? (yield* todayInAppZone);
  const start = shift(today, -input.back);
  const end = shift(today, input.ahead);
  const scope = yield* scopeAccounts(userId, input);
  const [opening, entries] = yield* Effect.all(
    [
      balanceBefore(scope, start),
      windowEntries(userId, scope.ids, start, end, input.includeDebts),
    ],
    { concurrency: "unbounded" },
  );

  return buildBalanceSeries({ opening, entries, start, end, today });
});

export const forecast = Effect.fn("dashboard.forecast")(function* (
  userId: string,
  input: ScopeInput,
  todayOverride?: string,
): Effect.fn.Return<ForecastMonth[], SqlError, Database | AppConfig> {
  const today = todayOverride ?? (yield* todayInAppZone);
  const { start, end } = forecastWindow(today);
  const scope = yield* scopeAccounts(userId, input);
  const [opening, entries] = yield* Effect.all(
    [
      balanceBefore(scope, start),
      windowEntries(userId, scope.ids, start, end, input.includeDebts),
    ],
    { concurrency: "unbounded" },
  );

  return buildForecast({ opening, entries, today });
});

export type NearestItem = DashboardEntry & {
  overdue: boolean;
  currencySign: string;
  /** Same-amount transfer between accounts of one currency: no +/- sign */
  unsigned: boolean;
};

/**
 * The first few dates with planned pairs (overdue ones on today), every
 * currency. A pair shows its display amount: the real-account leg for debts,
 * the outgoing leg otherwise.
 */
export const nearestPlanned = Effect.fn("dashboard.nearestPlanned")(function* (
  userId: string,
  todayOverride?: string,
): Effect.fn.Return<
  { date: string; items: NearestItem[] }[],
  SqlError,
  Database | AppConfig
> {
  const today = todayOverride ?? (yield* todayInAppZone);
  const dates = yield* nearestPlannedDates(userId, today, NEAREST_DAYS);
  const last = dates.at(-1);

  if (!last) {
    return [];
  }

  const rows = yield* dashboardPairs(userId, "planned", { endDate: last });
  const days = new Map<string, NearestItem[]>(dates.map((d) => [d, []]));

  for (const row of rows) {
    const primaryOnDebt = row.kind === "debt" && row.accountType === "debt";
    const amount = primaryOnDebt ? (row.linkedAmount ?? 0) : row.amount;
    const date = effectiveDate({ date: row.date, planned: true }, today);

    days.get(date)?.push({
      ...toEntry(row, amount),
      date,
      overdue: date !== row.date,
      currencySign:
        (primaryOnDebt ? row.linkedCurrencySign : row.currencySign) ?? "",
      unsigned:
        row.kind === "transfer" &&
        row.currencySign === row.linkedCurrencySign &&
        Math.abs(row.amount) === Math.abs(row.linkedAmount ?? 0),
    });
  }

  return dates.map((date) => ({ date, items: days.get(date) ?? [] }));
});
