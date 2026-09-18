import { type SQL, sql } from "drizzle-orm";

import { type DebtLabel, debtLabel } from "~/lib/debt-label";
import { amountFilterRange } from "~/lib/money";
import {
  type ListCursor,
  NO_CATEGORY,
  type TransactionFilter,
} from "~/lib/validators/transactions";
import type { DbOrTx } from "~/server/db";
import { today } from "~/server/lib/clock";

/*
 * Reads show a batched pair as ONE row: the leg with amount < 0 is primary
 * (`p`) and the other leg is attached as `l`. A pair is visible when the user
 * can read either leg's account, and every filter matches either leg.
 */

type Planned = "submitted" | "planned";

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A parenthesised, parameterised list for `IN`; callers pass non-empty lists */
const inList = (ids: string[]) =>
  sql`(${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;

/** The filter conditions, each matching either leg */
const filterConditions = (filter: Partial<TransactionFilter>): SQL[] => {
  const conditions: SQL[] = [];

  if (filter.accounts?.length) {
    conditions.push(
      sql`(p.account_id IN ${inList(filter.accounts)} OR l.account_id IN ${inList(filter.accounts)})`,
    );
  }

  if (filter.categories?.length) {
    const ids = filter.categories.filter((id) => id !== NO_CATEGORY);
    const parts: SQL[] = [];

    if (filter.categories.includes(NO_CATEGORY)) {
      // "no category" only matches non-batched rows without a category
      parts.push(sql`(p.batch_id IS NULL AND p.category_id IS NULL)`);
    }

    if (ids.length) {
      parts.push(
        sql`p.category_id IN ${inList(ids)} OR l.category_id IN ${inList(ids)}`,
      );
    }

    conditions.push(sql`(${sql.join(parts, sql` OR `)})`);
  }

  if (filter.counterparties?.length) {
    conditions.push(
      sql`(p.counterparty_id IN ${inList(filter.counterparties)} OR l.counterparty_id IN ${inList(filter.counterparties)})`,
    );
  }

  if (filter.startDate) {
    conditions.push(
      sql`(p.date >= ${filter.startDate}::date OR l.date >= ${filter.startDate}::date)`,
    );
  }

  if (filter.endDate) {
    conditions.push(
      sql`(p.date <= ${filter.endDate}::date OR l.date <= ${filter.endDate}::date)`,
    );
  }

  if (filter.amount) {
    const range = amountFilterRange(filter.amount);

    if (range) {
      conditions.push(
        sql`(abs(p.amount) BETWEEN ${range.min} AND ${range.max} OR abs(l.amount) BETWEEN ${range.min} AND ${range.max})`,
      );
    }
  }

  if (filter.comment) {
    const pattern = `%${escapeLike(filter.comment)}%`;

    conditions.push(
      sql`(p.comment ILIKE ${pattern} OR l.comment ILIKE ${pattern})`,
    );
  }

  return conditions;
};

/** FROM + WHERE shared by the list, totals, overdue and report queries */
const pairsFrom = (
  userId: string,
  planned: Planned,
  filter: Partial<TransactionFilter>,
  extra: SQL[] = [],
  joins: SQL = sql``,
) => {
  const readable = sql`(
    SELECT am.account_id FROM account_members am
    WHERE am.user_id = ${userId} AND am.deleted_at IS NULL AND am.can_read
  )`;

  const conditions = [
    sql`p.deleted_at IS NULL`,
    planned === "planned" ? sql`p.is_planned` : sql`NOT p.is_planned`,
    sql`(p.batch_id IS NULL OR p.amount < 0)`,
    sql`(p.account_id IN ${readable} OR l.account_id IN ${readable})`,
    ...filterConditions(filter),
    ...extra,
  ];

  return sql`
    FROM transactions p
    LEFT JOIN transactions l
      ON l.batch_id = p.batch_id AND l.id <> p.id AND l.deleted_at IS NULL
    JOIN accounts pa ON pa.id = p.account_id
    JOIN currencies pc ON pc.id = pa.currency_id
    LEFT JOIN accounts la ON la.id = l.account_id
    LEFT JOIN currencies lc ON lc.id = la.currency_id
    ${joins}
    WHERE ${sql.join(conditions, sql` AND `)}
  `;
};

type RawRow = {
  id: string;
  kind: "expense" | "income" | "transfer" | "debt";
  batch_id: string | null;
  date: string;
  amount: string;
  account_id: string;
  category_id: string | null;
  comment: string | null;
  counterparty_id: string | null;
  planned_transaction_id: string | null;
  is_planned: boolean;
  created_at: string;
  cursor_created_at: string;
  created_by: string;
  account_name: string;
  account_type: string;
  account_active: boolean;
  currency_id: string;
  currency_code: string;
  currency_sign: string;
  category_name: string | null;
  category_deleted: boolean | null;
  category_parent_name: string | null;
  counterparty_name: string | null;
  linked_id: string | null;
  linked_amount: string | null;
  linked_account_id: string | null;
  linked_account_name: string | null;
  linked_account_type: string | null;
  linked_account_active: boolean | null;
  linked_currency_id: string | null;
  linked_currency_code: string | null;
  linked_currency_sign: string | null;
  schedule_id: string | null;
  schedule_repeat_type: "daily" | "weekly" | "monthly" | "yearly" | null;
  schedule_repeat_interval: number | null;
  schedule_repeat_weekdays: number[] | null;
  schedule_start_date: string | null;
  schedule_end_date: string | null;
  schedule_deleted: boolean | null;
};

const selectColumns = sql`
  p.id, p.kind, p.batch_id, p.date, p.amount, p.account_id, p.category_id,
  p.comment, p.counterparty_id, p.planned_transaction_id, p.is_planned,
  p.created_at, p.created_at::text AS cursor_created_at, p.created_by,
  pa.name AS account_name, pa.type AS account_type,
  pa.is_active AS account_active,
  pc.id AS currency_id, pc.code AS currency_code, pc.sign AS currency_sign,
  cat.name AS category_name, cat.deleted_at IS NOT NULL AS category_deleted,
  parent.name AS category_parent_name,
  cp.name AS counterparty_name,
  l.id AS linked_id, l.amount AS linked_amount, l.account_id AS linked_account_id,
  la.name AS linked_account_name, la.type AS linked_account_type,
  la.is_active AS linked_account_active,
  lc.id AS linked_currency_id, lc.code AS linked_currency_code,
  lc.sign AS linked_currency_sign,
  pt.id AS schedule_id, pt.repeat_type AS schedule_repeat_type,
  pt.repeat_interval AS schedule_repeat_interval,
  pt.repeat_weekdays AS schedule_repeat_weekdays,
  pt.start_date AS schedule_start_date, pt.end_date AS schedule_end_date,
  pt.deleted_at IS NOT NULL AS schedule_deleted
`;

const displayJoins = sql`
  LEFT JOIN categories cat ON cat.id = p.category_id
  LEFT JOIN categories parent ON parent.id = cat.parent_id
  LEFT JOIN counterparties cp ON cp.id = p.counterparty_id
  LEFT JOIN planned_transactions pt ON pt.id = p.planned_transaction_id
`;

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
  kind: RawRow["kind"];
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

const mapRow = (row: RawRow): TransactionRow => {
  const linked =
    row.linked_id && row.linked_account_id
      ? {
          id: row.linked_id,
          amount: Number(row.linked_amount),
          account: {
            id: row.linked_account_id,
            name: row.linked_account_name ?? "",
            type: row.linked_account_type ?? "",
            isActive: row.linked_account_active ?? true,
            currencyId: row.linked_currency_id ?? "",
            currencyCode: row.linked_currency_code ?? "",
            currencySign: row.linked_currency_sign ?? "",
          },
        }
      : null;

  const amount = Number(row.amount);
  const realAmount =
    row.kind !== "debt"
      ? null
      : row.account_type === "debt"
        ? (linked?.amount ?? null)
        : amount;

  return {
    id: row.id,
    kind: row.kind,
    batchId: row.batch_id,
    date: row.date,
    amount,
    account: {
      id: row.account_id,
      name: row.account_name,
      type: row.account_type,
      isActive: row.account_active,
      currencyId: row.currency_id,
      currencyCode: row.currency_code,
      currencySign: row.currency_sign,
    },
    category: row.category_id
      ? {
          id: row.category_id,
          name: row.category_name ?? "",
          parentName: row.category_parent_name,
          deleted: row.category_deleted === true,
        }
      : null,
    comment: row.comment,
    counterparty:
      row.counterparty_id && row.counterparty_name
        ? { id: row.counterparty_id, name: row.counterparty_name }
        : null,
    isPlanned: row.is_planned,
    plannedTransactionId: row.planned_transaction_id,
    createdAt: new Date(row.created_at),
    createdBy: row.created_by,
    linked,
    schedule:
      row.schedule_id && row.schedule_repeat_type && !row.schedule_deleted
        ? {
            id: row.schedule_id,
            repeatType: row.schedule_repeat_type,
            repeatInterval: row.schedule_repeat_interval ?? 1,
            repeatWeekdays: row.schedule_repeat_weekdays ?? [],
            startDate: row.schedule_start_date ?? "",
            endDate: row.schedule_end_date,
          }
        : null,
    direction: realAmount === null ? null : realAmount < 0 ? "gave" : "took",
    debtLabel: null,
    cursor: { date: row.date, createdAt: row.cursor_created_at, id: row.id },
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

  const windows = await db.execute<{
    id: string;
    amount: string;
    prev_submitted: string;
    prev_projected: string;
  }>(sql`
    SELECT w.id, w.amount, w.prev_submitted, w.prev_projected FROM (
      SELECT t.id, t.amount,
        COALESCE(SUM(t.amount) FILTER (WHERE NOT t.is_planned) OVER w, 0) AS prev_submitted,
        COALESCE(SUM(t.amount) OVER w, 0) AS prev_projected
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.type = 'debt'
        AND t.deleted_at IS NULL
        AND t.counterparty_id IN ${inList(counterpartyIds)}
      WINDOW w AS (
        PARTITION BY t.counterparty_id, a.currency_id
        ORDER BY t.date, t.created_at, t.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      )
    ) w
    WHERE w.id IN ${inList(legIds)}
  `);

  const byId = new Map([...windows].map((row) => [row.id, row]));

  for (const row of debtRows) {
    const window = byId.get(debtLegId(row));

    if (!window) {
      continue;
    }

    const before = Number(
      row.isPlanned ? window.prev_projected : window.prev_submitted,
    );

    row.debtLabel = {
      ...debtLabel(before, Number(window.amount)),
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
      ? sql`(p.date, p.created_at, p.id) < (${cursor.date}::date, ${cursor.createdAt}::timestamptz, ${cursor.id})`
      : sql`(p.date, p.created_at, p.id) > (${cursor.date}::date, ${cursor.createdAt}::timestamptz, ${cursor.id})`
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
    extra?: SQL[];
  },
): Promise<{ items: TransactionRow[]; nextCursor: ListCursor | null }> => {
  // submitted: newest first; planned: oldest first
  const desc = planned === "submitted";
  const after = cursorCondition(cursor, desc);
  const order = desc
    ? sql`p.date DESC, p.created_at DESC, p.id DESC`
    : sql`p.date ASC, p.created_at ASC, p.id ASC`;

  const raw = await db.execute<RawRow>(sql`
    SELECT ${selectColumns}
    ${pairsFrom(
      userId,
      planned,
      filter,
      [...extra, ...(after ? [after] : [])],
      displayJoins,
    )}
    ORDER BY ${order}
    LIMIT ${limit + 1}
  `);

  const rows = [...raw].map(mapRow);
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
    extra: [sql`p.date <= ${today()}::date`],
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
 * submitted rows. Transfers between two non-debt accounts net to zero and are
 * left out; for a debt pair the real-account leg is what counts.
 */
export const filteredTotals = async (
  db: DbOrTx,
  userId: string,
  filter: Partial<TransactionFilter>,
): Promise<CurrencyTotal[]> => {
  const rows = await db.execute<{
    currency_id: string;
    currency_code: string;
    currency_sign: string;
    expenses: string | null;
    incomes: string | null;
  }>(sql`
    SELECT x.currency_id, c.code AS currency_code, c.sign AS currency_sign,
      SUM(x.amount) FILTER (WHERE x.amount < 0) AS expenses,
      SUM(x.amount) FILTER (WHERE x.amount > 0) AS incomes
    FROM (
      SELECT
        CASE WHEN p.batch_id IS NOT NULL AND pa.type = 'debt'
          THEN l.amount ELSE p.amount END AS amount,
        CASE WHEN p.batch_id IS NOT NULL AND pa.type = 'debt'
          THEN la.currency_id ELSE pa.currency_id END AS currency_id
      ${pairsFrom(userId, "submitted", filter, [
        sql`NOT (p.batch_id IS NOT NULL AND pa.type <> 'debt' AND la.type <> 'debt')`,
      ])}
    ) x
    JOIN currencies c ON c.id = x.currency_id
    GROUP BY x.currency_id, c.code, c.sign
    ORDER BY c.code
  `);

  return [...rows]
    .map((row) => {
      const expenses = Number(row.expenses ?? 0);
      const incomes = Number(row.incomes ?? 0);

      return {
        currencyId: row.currency_id,
        currencyCode: row.currency_code,
        currencySign: row.currency_sign,
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
  const raw = await db.execute<{
    id: string;
    date: string;
    amount: string;
    currency_code: string;
    currency_sign: string;
    category_id: string | null;
    category_name: string | null;
    parent_id: string | null;
    parent_name: string | null;
    comment: string | null;
  }>(sql`
    SELECT p.id, p.date,
      CASE WHEN p.batch_id IS NOT NULL AND pa.type = 'debt'
        THEN l.amount ELSE p.amount END AS amount,
      CASE WHEN p.batch_id IS NOT NULL AND pa.type = 'debt'
        THEN lc.code ELSE pc.code END AS currency_code,
      CASE WHEN p.batch_id IS NOT NULL AND pa.type = 'debt'
        THEN lc.sign ELSE pc.sign END AS currency_sign,
      cat.id AS category_id, cat.name AS category_name,
      parent.id AS parent_id, parent.name AS parent_name,
      p.comment
    ${pairsFrom(
      userId,
      "submitted",
      filter,
      [
        sql`NOT (p.batch_id IS NOT NULL AND pa.type <> 'debt' AND la.type <> 'debt')`,
      ],
      sql`
        LEFT JOIN categories cat ON cat.id = p.category_id
        LEFT JOIN categories parent ON parent.id = cat.parent_id
      `,
    )}
    ORDER BY p.date, p.created_at, p.id
    LIMIT ${limit + 1}
  `);

  const rows = [...raw].map((row) => ({
    id: row.id,
    date: row.date,
    amount: Number(row.amount),
    currencyCode: row.currency_code,
    currencySign: row.currency_sign,
    categoryId: row.category_id,
    categoryName: row.category_name,
    parentId: row.parent_id,
    parentName: row.parent_name,
    comment: row.comment,
  }));

  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
};
