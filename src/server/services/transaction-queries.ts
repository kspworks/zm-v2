import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  alias,
  type PgSelectBase,
  type SelectedFields,
} from "drizzle-orm/pg-core";

import { type DebtLabel, debtLabel } from "~/lib/debt-label";
import { amountFilterRange } from "~/lib/money";
import {
  type ListCursor,
  NO_CATEGORY,
  type TransactionFilter,
} from "~/lib/validators/transactions";
import type { DbOrTx } from "~/server/db";
import {
  accountMembers,
  accounts,
  categories,
  counterparties,
  currencies,
  plannedTransactions,
  transactions,
} from "~/server/db/schema";
import { today } from "~/server/lib/clock";

/*
 * Reads show a batched pair as ONE row: the leg with amount < 0 is primary
 * (`p`) and the other leg is attached as `l`. A pair is visible when the user
 * can read either leg's account, and every filter matches either leg.
 */

type Planned = "submitted" | "planned";

const p = alias(transactions, "p");
const l = alias(transactions, "l");
const pa = alias(accounts, "pa");
const la = alias(accounts, "la");
const pc = alias(currencies, "pc");
const lc = alias(currencies, "lc");
const cat = alias(categories, "cat");
const parent = alias(categories, "parent");
const cp = alias(counterparties, "cp");
const pt = alias(plannedTransactions, "pt");

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The filter conditions, each matching either leg */
const filterConditions = (filter: Partial<TransactionFilter>) => {
  const conditions: (SQL | undefined)[] = [];

  if (filter.accounts?.length) {
    conditions.push(
      or(
        inArray(p.accountId, filter.accounts),
        inArray(l.accountId, filter.accounts),
      ),
    );
  }

  if (filter.categories?.length) {
    const ids = filter.categories.filter((id) => id !== NO_CATEGORY);
    const parts: (SQL | undefined)[] = [];

    if (filter.categories.includes(NO_CATEGORY)) {
      // "no category" only matches non-batched rows without a category
      parts.push(and(isNull(p.batchId), isNull(p.categoryId)));
    }

    if (ids.length) {
      parts.push(inArray(p.categoryId, ids), inArray(l.categoryId, ids));
    }

    conditions.push(or(...parts));
  }

  if (filter.counterparties?.length) {
    conditions.push(
      or(
        inArray(p.counterpartyId, filter.counterparties),
        inArray(l.counterpartyId, filter.counterparties),
      ),
    );
  }

  if (filter.startDate) {
    conditions.push(
      or(gte(p.date, filter.startDate), gte(l.date, filter.startDate)),
    );
  }

  if (filter.endDate) {
    conditions.push(
      or(lte(p.date, filter.endDate), lte(l.date, filter.endDate)),
    );
  }

  if (filter.amount) {
    const range = amountFilterRange(filter.amount);

    if (range) {
      conditions.push(
        or(
          between(sql`abs(${p.amount})`, range.min, range.max),
          between(sql`abs(${l.amount})`, range.min, range.max),
        ),
      );
    }
  }

  if (filter.comment) {
    const pattern = `%${escapeLike(filter.comment)}%`;

    conditions.push(or(ilike(p.comment, pattern), ilike(l.comment, pattern)));
  }

  return conditions;
};

/** Leaves out transfers between two real accounts, which net to zero */
const notOwnTransfer = or(
  isNull(p.batchId),
  eq(pa.type, "debt"),
  eq(la.type, "debt"),
);

/** For a debt pair the real-account leg is what counts */
const primaryIsDebtLeg = and(isNotNull(p.batchId), eq(pa.type, "debt"));

/** Which of the pairsQuery tables are left-joined, and so may be null */
type PairsNullability = {
  p: "not-null";
  l: "nullable";
  pa: "not-null";
  pc: "not-null";
  la: "nullable";
  lc: "nullable";
  cat: "nullable";
  parent: "nullable";
  cp: "nullable";
  pt: "nullable";
};

/**
 * Pairs with their accounts, currencies and display joins, shared by the
 * list, totals, overdue and report queries. Unused display joins are left
 * joins on primary keys, which Postgres removes from the plan.
 *
 * Drizzle can't resolve join result types over a generic selection, so the
 * chain is built on the base type and the result typed from PairsNullability.
 */
const pairsQuery = <TFields extends SelectedFields>(
  db: DbOrTx,
  fields: TFields,
  userId: string,
  planned: Planned,
  filter: Partial<TransactionFilter>,
  extra: (SQL | undefined)[] = [],
): PgSelectBase<"p", TFields, "partial", PairsNullability, true> => {
  const readable = db
    .select({ id: accountMembers.accountId })
    .from(accountMembers)
    .where(
      and(
        eq(accountMembers.userId, userId),
        isNull(accountMembers.deletedAt),
        eq(accountMembers.canRead, true),
      ),
    );

  return db
    .select(fields as SelectedFields)
    .from(p)
    .$dynamic()
    .leftJoin(
      l,
      and(eq(l.batchId, p.batchId), ne(l.id, p.id), isNull(l.deletedAt)),
    )
    .innerJoin(pa, eq(pa.id, p.accountId))
    .innerJoin(pc, eq(pc.id, pa.currencyId))
    .leftJoin(la, eq(la.id, l.accountId))
    .leftJoin(lc, eq(lc.id, la.currencyId))
    .leftJoin(cat, eq(cat.id, p.categoryId))
    .leftJoin(parent, eq(parent.id, cat.parentId))
    .leftJoin(cp, eq(cp.id, p.counterpartyId))
    .leftJoin(pt, eq(pt.id, p.plannedTransactionId))
    .where(
      and(
        isNull(p.deletedAt),
        eq(p.isPlanned, planned === "planned"),
        or(isNull(p.batchId), lt(p.amount, 0)),
        or(inArray(p.accountId, readable), inArray(l.accountId, readable)),
        ...filterConditions(filter),
        ...extra,
      ),
    ) as unknown as PgSelectBase<
    "p",
    TFields,
    "partial",
    PairsNullability,
    true
  >;
};

const listFields = {
  id: p.id,
  kind: p.kind,
  batchId: p.batchId,
  date: p.date,
  amount: p.amount,
  accountId: p.accountId,
  categoryId: p.categoryId,
  comment: p.comment,
  counterpartyId: p.counterpartyId,
  plannedTransactionId: p.plannedTransactionId,
  isPlanned: p.isPlanned,
  createdAt: p.createdAt,
  // full microsecond precision, so the cursor never skips a row
  cursorCreatedAt: sql<string>`${p.createdAt}::text`,
  createdBy: p.createdBy,
  accountName: pa.name,
  accountType: pa.type,
  accountActive: pa.isActive,
  currencyId: pc.id,
  currencyCode: pc.code,
  currencySign: pc.sign,
  categoryName: cat.name,
  categoryDeletedAt: cat.deletedAt,
  categoryParentName: parent.name,
  counterpartyName: cp.name,
  linkedId: l.id,
  linkedAmount: l.amount,
  linkedAccountId: l.accountId,
  linkedAccountName: la.name,
  linkedAccountType: la.type,
  linkedAccountActive: la.isActive,
  linkedCurrencyId: lc.id,
  linkedCurrencyCode: lc.code,
  linkedCurrencySign: lc.sign,
  scheduleId: pt.id,
  scheduleRepeatType: pt.repeatType,
  scheduleRepeatInterval: pt.repeatInterval,
  scheduleRepeatWeekdays: pt.repeatWeekdays,
  scheduleStartDate: pt.startDate,
  scheduleEndDate: pt.endDate,
  scheduleDeletedAt: pt.deletedAt,
};

const listQuery = (
  db: DbOrTx,
  userId: string,
  planned: Planned,
  filter: Partial<TransactionFilter>,
  extra: (SQL | undefined)[],
) => pairsQuery(db, listFields, userId, planned, filter, extra);

type ListRow = Awaited<ReturnType<typeof listQuery>>[number];

export type TransactionAccountRef = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  currencyId: string;
  currencyCode: string;
  currencySign: string;
};

export type TransactionRow = {
  id: string;
  kind: (typeof transactions.$inferSelect)["kind"];
  batchId: string | null;
  date: string;
  amount: number;
  account: TransactionAccountRef;
  category: {
    id: string;
    name: string;
    parentName: string | null;
    deleted: boolean;
  } | null;
  comment: string | null;
  counterparty: { id: string; name: string } | null;
  isPlanned: boolean;
  plannedTransactionId: string | null;
  createdAt: Date;
  createdBy: string;
  linked: {
    id: string;
    amount: number;
    account: TransactionAccountRef;
  } | null;
  schedule: {
    id: string;
    repeatType: "daily" | "weekly" | "monthly" | "yearly";
    repeatInterval: number;
    repeatWeekdays: number[];
    startDate: string;
    endDate: string | null;
  } | null;
  /** "gave"/"took" for debts, from the real-account leg */
  direction: "gave" | "took" | null;
  debtLabel: (DebtLabel & { forecast: boolean }) | null;
  cursor: ListCursor;
};

const mapRow = (row: ListRow): TransactionRow => {
  const linked =
    row.linkedId && row.linkedAccountId
      ? {
          id: row.linkedId,
          amount: row.linkedAmount ?? 0,
          account: {
            id: row.linkedAccountId,
            name: row.linkedAccountName ?? "",
            type: row.linkedAccountType ?? "",
            isActive: row.linkedAccountActive ?? true,
            currencyId: row.linkedCurrencyId ?? "",
            currencyCode: row.linkedCurrencyCode ?? "",
            currencySign: row.linkedCurrencySign ?? "",
          },
        }
      : null;

  const realAmount =
    row.kind !== "debt"
      ? null
      : row.accountType === "debt"
        ? (linked?.amount ?? null)
        : row.amount;

  return {
    id: row.id,
    kind: row.kind,
    batchId: row.batchId,
    date: row.date,
    amount: row.amount,
    account: {
      id: row.accountId,
      name: row.accountName,
      type: row.accountType,
      isActive: row.accountActive,
      currencyId: row.currencyId,
      currencyCode: row.currencyCode,
      currencySign: row.currencySign,
    },
    category: row.categoryId
      ? {
          id: row.categoryId,
          name: row.categoryName ?? "",
          parentName: row.categoryParentName,
          deleted: row.categoryDeletedAt !== null,
        }
      : null,
    comment: row.comment,
    counterparty:
      row.counterpartyId && row.counterpartyName
        ? { id: row.counterpartyId, name: row.counterpartyName }
        : null,
    isPlanned: row.isPlanned,
    plannedTransactionId: row.plannedTransactionId,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    linked,
    schedule:
      row.scheduleId && row.scheduleRepeatType && !row.scheduleDeletedAt
        ? {
            id: row.scheduleId,
            repeatType: row.scheduleRepeatType,
            repeatInterval: row.scheduleRepeatInterval ?? 1,
            repeatWeekdays: row.scheduleRepeatWeekdays ?? [],
            startDate: row.scheduleStartDate ?? "",
            endDate: row.scheduleEndDate,
          }
        : null,
    direction: realAmount === null ? null : realAmount < 0 ? "gave" : "took",
    debtLabel: null,
    cursor: { date: row.date, createdAt: row.cursorCreatedAt, id: row.id },
  };
};

/**
 * Labels debt rows (section 14.1). The running balance before each entry is a
 * window over the counterparty's whole history in that currency, computed
 * before (and independently of) the list filters, so filtering never changes
 * a label. Only the partitions of the given rows are scanned.
 */
const attachDebtLabels = async (db: DbOrTx, rows: TransactionRow[]) => {
  const debtRows = rows.filter(
    (row) => row.kind === "debt" && row.counterparty && row.linked,
  );

  if (debtRows.length === 0) {
    return;
  }

  const debtLegId = (row: TransactionRow) =>
    row.account.type === "debt" ? row.id : (row.linked?.id ?? "");
  const legIds = debtRows.map(debtLegId);
  const counterpartyIds = [
    ...new Set(debtRows.map((row) => row.counterparty?.id ?? "")),
  ];

  const t = alias(transactions, "t");
  const a = alias(accounts, "a");
  const window = sql`over (
    partition by ${t.counterpartyId}, ${a.currencyId}
    order by ${t.date}, ${t.createdAt}, ${t.id}
    rows between unbounded preceding and 1 preceding
  )`;

  const w = db
    .select({
      id: t.id,
      amount: t.amount,
      prevSubmitted:
        sql<string>`coalesce(sum(${t.amount}) filter (where not ${t.isPlanned}) ${window}, 0)`.as(
          "prev_submitted",
        ),
      prevProjected: sql<string>`coalesce(sum(${t.amount}) ${window}, 0)`.as(
        "prev_projected",
      ),
    })
    .from(t)
    .innerJoin(a, eq(a.id, t.accountId))
    .where(
      and(
        eq(a.type, "debt"),
        isNull(t.deletedAt),
        inArray(t.counterpartyId, counterpartyIds),
      ),
    )
    .as("w");

  const windows = await db.select().from(w).where(inArray(w.id, legIds));

  const byId = new Map(windows.map((row) => [row.id, row]));

  for (const row of debtRows) {
    const window = byId.get(debtLegId(row));

    if (!window) {
      continue;
    }

    const before = Number(
      row.isPlanned ? window.prevProjected : window.prevSubmitted,
    );

    row.debtLabel = {
      ...debtLabel(before, window.amount),
      forecast: row.isPlanned,
    };
  }
};

const cursorCondition = (
  cursor: ListCursor | null | undefined,
  desc: boolean,
) =>
  cursor
    ? desc
      ? sql`(${p.date}, ${p.createdAt}, ${p.id}) < (${cursor.date}::date, ${cursor.createdAt}::timestamptz, ${cursor.id})`
      : sql`(${p.date}, ${p.createdAt}, ${p.id}) > (${cursor.date}::date, ${cursor.createdAt}::timestamptz, ${cursor.id})`
    : undefined;

export const listTransactions = async (
  db: DbOrTx,
  userId: string,
  {
    filter,
    cursor,
    planned,
    limit,
    extra = [],
  }: {
    filter: Partial<TransactionFilter>;
    cursor?: ListCursor | null;
    planned: Planned;
    limit: number;
    extra?: (SQL | undefined)[];
  },
): Promise<{ items: TransactionRow[]; nextCursor: ListCursor | null }> => {
  // submitted: newest first; planned: oldest first
  const newestFirst = planned === "submitted";
  const direction = newestFirst ? desc : asc;

  const raw = await listQuery(db, userId, planned, filter, [
    ...extra,
    cursorCondition(cursor, newestFirst),
  ])
    .orderBy(direction(p.date), direction(p.createdAt), direction(p.id))
    .limit(limit + 1);

  const rows = raw.map(mapRow);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  await attachDebtLabels(db, items);

  return {
    items,
    nextCursor: hasMore ? (items.at(-1)?.cursor ?? null) : null,
  };
};

/** Planned rows due today or earlier ("Planned and overdue"), capped at 50 */
export const listOverdue = (
  db: DbOrTx,
  userId: string,
  filter: Partial<TransactionFilter>,
) =>
  listTransactions(db, userId, {
    filter,
    planned: "planned",
    limit: 50,
    extra: [lte(p.date, today())],
  }).then((result) => result.items);

export type CurrencyTotal = {
  currencyId: string;
  currencyCode: string;
  currencySign: string;
  expenses: number;
  incomes: number;
  total: number;
};

/**
 * Expenses, incomes and total per currency over the WHOLE filtered set of
 * submitted (or planned) rows. Transfers between two non-debt accounts net to zero and are
 * left out; for a debt pair the real-account leg is what counts.
 */
export const filteredTotals = async (
  db: DbOrTx,
  userId: string,
  filter: Partial<TransactionFilter>,
  planned: Planned = "submitted",
): Promise<CurrencyTotal[]> => {
  const x = pairsQuery(
    db,
    {
      amount:
        sql<number>`case when ${primaryIsDebtLeg} then ${l.amount} else ${p.amount} end`.as(
          "amount",
        ),
      currencyId:
        sql<string>`case when ${primaryIsDebtLeg} then ${la.currencyId} else ${pa.currencyId} end`.as(
          "currency_id",
        ),
    },
    userId,
    planned,
    filter,
    [notOwnTransfer],
  ).as("x");

  const rows = await db
    .select({
      currencyId: x.currencyId,
      currencyCode: currencies.code,
      currencySign: currencies.sign,
      expenses: sql<
        string | null
      >`sum(${x.amount}) filter (where ${x.amount} < 0)`,
      incomes: sql<
        string | null
      >`sum(${x.amount}) filter (where ${x.amount} > 0)`,
    })
    .from(x)
    .innerJoin(currencies, eq(currencies.id, x.currencyId))
    .groupBy(x.currencyId, currencies.code, currencies.sign)
    .orderBy(asc(currencies.code));

  return rows
    .map((row) => {
      const expenses = Number(row.expenses ?? 0);
      const incomes = Number(row.incomes ?? 0);

      return {
        currencyId: row.currencyId,
        currencyCode: row.currencyCode,
        currencySign: row.currencySign,
        expenses,
        incomes,
        total: expenses + incomes,
      };
    })
    .filter((row) => row.expenses !== 0 || row.incomes !== 0);
};

export const REPORT_LIMIT = 100_000;

export type ReportRow = {
  id: string;
  date: string;
  amount: number;
  currencyCode: string;
  currencySign: string;
  categoryId: string | null;
  categoryName: string | null;
  parentId: string | null;
  parentName: string | null;
  comment: string | null;
};

/**
 * Report data: submitted rows in range, counted like the totals (no
 * own-account transfers, a debt pair by its real-account leg), capped at
 * REPORT_LIMIT; limit + 1 is fetched so truncation is reported, not hidden.
 */
export const reportRows = async (
  db: DbOrTx,
  userId: string,
  filter: Partial<TransactionFilter>,
  limit = REPORT_LIMIT,
): Promise<{ rows: ReportRow[]; truncated: boolean }> => {
  const rows = await pairsQuery(
    db,
    {
      id: p.id,
      date: p.date,
      amount:
        sql<number>`case when ${primaryIsDebtLeg} then ${l.amount} else ${p.amount} end`.mapWith(
          Number,
        ),
      currencyCode: sql<string>`case when ${primaryIsDebtLeg} then ${lc.code} else ${pc.code} end`,
      currencySign: sql<string>`case when ${primaryIsDebtLeg} then ${lc.sign} else ${pc.sign} end`,
      categoryId: cat.id,
      categoryName: cat.name,
      parentId: parent.id,
      parentName: parent.name,
      comment: p.comment,
    },
    userId,
    "submitted",
    filter,
    [notOwnTransfer],
  )
    .orderBy(asc(p.date), asc(p.createdAt), asc(p.id))
    .limit(limit + 1);

  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
};

export type DashboardPairRow = {
  id: string;
  kind: (typeof transactions.$inferSelect)["kind"];
  date: string;
  isPlanned: boolean;
  amount: number;
  accountId: string;
  accountName: string;
  accountType: string;
  currencySign: string;
  linkedAmount: number | null;
  linkedAccountId: string | null;
  linkedAccountName: string | null;
  linkedCurrencySign: string | null;
  categoryName: string | null;
  categoryParentName: string | null;
  comment: string | null;
  counterpartyName: string | null;
};

/**
 * Pairs for the dashboard with both legs' amounts and accounts, so callers
 * can work out a pair's net effect on a set of accounts (a transfer with a
 * fee is not zero). Unlike the totals, own-account transfers are kept.
 */
export const dashboardPairs = (
  db: DbOrTx,
  userId: string,
  planned: Planned,
  {
    accountIds,
    startDate,
    endDate,
  }: { accountIds?: string[]; startDate?: string; endDate?: string },
): Promise<DashboardPairRow[]> =>
  pairsQuery(
    db,
    {
      id: p.id,
      kind: p.kind,
      date: p.date,
      isPlanned: p.isPlanned,
      amount: p.amount,
      accountId: p.accountId,
      accountName: pa.name,
      accountType: pa.type,
      currencySign: pc.sign,
      linkedAmount: l.amount,
      linkedAccountId: l.accountId,
      linkedAccountName: la.name,
      linkedCurrencySign: lc.sign,
      categoryName: cat.name,
      categoryParentName: parent.name,
      comment: p.comment,
      counterpartyName: cp.name,
    },
    userId,
    planned,
    {},
    [
      accountIds
        ? or(inArray(p.accountId, accountIds), inArray(l.accountId, accountIds))
        : undefined,
      startDate ? gte(p.date, startDate) : undefined,
      endDate ? lte(p.date, endDate) : undefined,
    ],
  ).orderBy(asc(p.date), asc(p.createdAt), asc(p.id));

/**
 * The first `limit` distinct dates with planned pairs, overdue ones counted
 * as today.
 */
export const nearestPlannedDates = async (
  db: DbOrTx,
  userId: string,
  todayDate: string,
  limit: number,
): Promise<string[]> => {
  const x = pairsQuery(
    db,
    { day: sql<string>`greatest(${p.date}, ${todayDate}::date)`.as("day") },
    userId,
    "planned",
    {},
  ).as("x");

  const rows = await db
    .selectDistinct({ day: sql<string>`${x.day}::text` })
    .from(x)
    .orderBy(sql`1`)
    .limit(limit);

  return rows.map((row) => row.day);
};
