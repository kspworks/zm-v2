import { z } from "zod";

import type { DebtLabel } from "~/lib/debt-label";

/** What the top-level tiles stand for. */
export const reportGroupBySchema = z.enum([
  "category",
  "account",
  "counterparty",
]);

export type ReportGroupBy = z.infer<typeof reportGroupBySchema>;

/** Tile key of the "No category" / "No counterparty" tile. */
export const NONE_KEY = "__none__";

/** Tile key of the "Debts" tile, which holds every debt pair in the view. */
export const DEBTS_KEY = "__debts__";

export type ReportInput = {
  id: string;
  kind: "expense" | "income" | "transfer" | "debt";
  date: string;
  amount: number;
  currencyCode: string;
  currencySign: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  parentId: string | null;
  parentName: string | null;
  comment: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  debtLabel: DebtLabel | null;
};

export type ReportLeaf = {
  id: string;
  name: string;
  value: number;
  date: string;
  category: string;
  comment: string | null;
};

export type ReportTile = {
  key: string;
  name: string;
  value: number;
  children: ReportLeaf[];
};

export type ReportChart = {
  currencyCode: string;
  currencySign: string;
  total: number;
  tiles: ReportTile[];
};

/**
 * One chart per currency (never summed across currencies), largest total
 * first. Expense and income are separate views: only negative or positive
 * amounts count, as absolute values. Tiles follow `groupBy`:
 * - `category`: children roll up under their parent; debt pairs (lent,
 *   borrowed, repaid) form one "Debts" tile; other rows without a category
 *   form a "No category" tile.
 * - `account`: one tile per account; a debt pair counts on its real account.
 * - `counterparty`: one tile per counterparty, debts included; rows without
 *   one form a "No counterparty" tile.
 * Leaves are single transactions, debts described by `debtDescription`.
 * Zero-total tiles are dropped.
 */
export const buildReport = (
  rows: ReportInput[],
  view: "expense" | "income",
  groupBy: ReportGroupBy,
  labels: {
    noCategory: string;
    noCounterparty: string;
    debts: string;
    debtDescription: (row: ReportInput) => string;
  },
): ReportChart[] => {
  const groupOf = (row: ReportInput): [key: string, name: string] => {
    switch (groupBy) {
      case "account":
        return [row.accountId, row.accountName];
      case "counterparty":
        return [
          row.counterpartyId ?? NONE_KEY,
          row.counterpartyName ?? labels.noCounterparty,
        ];
      default:
        return row.kind === "debt"
          ? [DEBTS_KEY, labels.debts]
          : [
              row.parentId ?? row.categoryId ?? NONE_KEY,
              row.parentName ?? row.categoryName ?? labels.noCategory,
            ];
    }
  };

  const charts = new Map<
    string,
    { sign: string; tiles: Map<string, ReportTile> }
  >();

  for (const row of rows) {
    if (view === "expense" ? row.amount >= 0 : row.amount <= 0) {
      continue;
    }

    const value = Math.abs(row.amount);
    const chart = charts.get(row.currencyCode) ?? {
      sign: row.currencySign,
      tiles: new Map(),
    };
    charts.set(row.currencyCode, chart);

    const description =
      row.kind === "debt" ? labels.debtDescription(row) : null;
    const [topId, topName] = groupOf(row);
    const tile = chart.tiles.get(topId) ?? {
      key: topId,
      name: topName,
      value: 0,
      children: [],
    };
    chart.tiles.set(topId, tile);

    tile.value += value;
    tile.children.push({
      id: row.id,
      name: row.comment ?? description ?? row.categoryName ?? labels.noCategory,
      value,
      date: row.date,
      category:
        description ??
        (row.parentName
          ? `${row.parentName} → ${row.categoryName ?? ""}`
          : (row.categoryName ?? labels.noCategory)),
      comment: row.comment,
    });
  }

  return [...charts.entries()]
    .map(([currencyCode, chart]) => {
      const tiles = [...chart.tiles.values()]
        .filter((tile) => tile.value !== 0)
        .map((tile) => ({
          ...tile,
          children: tile.children.sort((a, b) => b.value - a.value),
        }))
        .sort((a, b) => b.value - a.value);

      return {
        currencyCode,
        currencySign: chart.sign,
        total: tiles.reduce((sum, tile) => sum + tile.value, 0),
        tiles,
      };
    })
    .filter((chart) => chart.total !== 0)
    .sort((a, b) => b.total - a.total);
};

/**
 * Color slot (1..slots) per tile key. The largest tiles in the view win, so
 * the blocks that dominate the chart are the ones told apart; totals are
 * summed across currencies so a tile keeps one color in every chart.
 * "No category" / "No counterparty" and the tail past `slots` get no slot
 * (gray).
 */
export const colorSlots = (
  charts: ReportChart[],
  slots: number,
): Map<string, number> => {
  const totals = new Map<string, number>();

  for (const chart of charts) {
    for (const tile of chart.tiles) {
      if (tile.key !== NONE_KEY) {
        totals.set(tile.key, (totals.get(tile.key) ?? 0) + tile.value);
      }
    }
  }

  return new Map(
    [...totals.entries()]
      .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, slots)
      .map(([key], index) => [key, index + 1]),
  );
};

/** One period's totals for one currency and leaf category (debts apart). */
export type ComparisonInput = {
  currencyCode: string;
  currencySign: string;
  isDebt: boolean;
  categoryId: string | null;
  categoryName: string | null;
  parentId: string | null;
  parentName: string | null;
  incomes: number;
  expenses: number;
};

export type ComparisonPair = { a: number; b: number };

export type ComparisonRow = ComparisonPair & {
  key: string;
  name: string;
  children: ComparisonRow[];
};

export type ComparisonSection = {
  total: ComparisonPair;
  rows: ComparisonRow[];
};

export type ComparisonTable = {
  currencyCode: string;
  currencySign: string;
  income: ComparisonSection;
  expense: ComparisonSection;
  /** Income minus expense, per period */
  remainder: ComparisonPair;
};

/** "No category" and "Debts" close their section, whatever their size */
const pinnedLast = (key: string) => key === NONE_KEY || key === DEBTS_KEY;

const byMaxDesc = (x: ComparisonRow, y: ComparisonRow) =>
  Number(pinnedLast(x.key)) - Number(pinnedLast(y.key)) ||
  Math.max(y.a, y.b) - Math.max(x.a, x.b) ||
  x.name.localeCompare(y.name);

/**
 * Period A vs period B, one table per currency (never summed across
 * currencies), largest first. Incomes and expenses are separate sections of
 * absolute amounts, so a category used both ways appears in both. Rows roll
 * children up under their parent, which lists them as `children` when it has
 * any besides itself; debt pairs form one "Debts" row and rows without a
 * category a "No category" row. Rows are sorted by the larger period, with
 * "No category" and "Debts" last.
 */
export const buildComparison = (
  a: ComparisonInput[],
  b: ComparisonInput[],
  labels: { noCategory: string; debts: string },
): ComparisonTable[] => {
  type Section = Map<
    string,
    ComparisonRow & { leaves: Map<string, ComparisonRow> }
  >;
  const tables = new Map<
    string,
    { sign: string; income: Section; expense: Section }
  >();

  const add = (rows: ComparisonInput[], period: "a" | "b") => {
    for (const row of rows) {
      const table = tables.get(row.currencyCode) ?? {
        sign: row.currencySign,
        income: new Map(),
        expense: new Map(),
      };
      tables.set(row.currencyCode, table);

      const [key, name] = row.isDebt
        ? [DEBTS_KEY, labels.debts]
        : [
            row.parentId ?? row.categoryId ?? NONE_KEY,
            row.parentName ?? row.categoryName ?? labels.noCategory,
          ];
      const leafKey = row.isDebt ? DEBTS_KEY : (row.categoryId ?? NONE_KEY);
      const leafName = row.isDebt
        ? labels.debts
        : (row.categoryName ?? labels.noCategory);

      for (const [section, value] of [
        [table.income, row.incomes],
        [table.expense, -row.expenses],
      ] as const) {
        if (value === 0) {
          continue;
        }

        const top = section.get(key) ?? {
          key,
          name,
          a: 0,
          b: 0,
          children: [],
          leaves: new Map(),
        };
        section.set(key, top);
        top[period] += value;

        const leaf = top.leaves.get(leafKey) ?? {
          key: leafKey,
          name: leafName,
          a: 0,
          b: 0,
          children: [],
        };
        top.leaves.set(leafKey, leaf);
        leaf[period] += value;
      }
    }
  };

  add(a, "a");
  add(b, "b");

  const sectionOf = (section: Section): ComparisonSection => {
    const rows = [...section.values()]
      .map(({ leaves, ...row }) => {
        const children = [...leaves.values()].sort(byMaxDesc);
        const onlySelf = children.length === 1 && children[0]?.key === row.key;

        return { ...row, children: onlySelf ? [] : children };
      })
      .sort(byMaxDesc);

    return {
      total: {
        a: rows.reduce((sum, row) => sum + row.a, 0),
        b: rows.reduce((sum, row) => sum + row.b, 0),
      },
      rows,
    };
  };

  return [...tables.entries()]
    .map(([currencyCode, table]) => {
      const income = sectionOf(table.income);
      const expense = sectionOf(table.expense);

      return {
        currencyCode,
        currencySign: table.sign,
        income,
        expense,
        remainder: {
          a: income.total.a - expense.total.a,
          b: income.total.b - expense.total.b,
        },
      };
    })
    .sort((x, y) => volume(y) - volume(x));
};

const volume = (table: ComparisonTable) =>
  table.income.total.a +
  table.income.total.b +
  table.expense.total.a +
  table.expense.total.b;

/**
 * B minus A, and the change relative to A as a fraction; `percent` is null
 * when A is 0 and B isn't (a new value).
 */
export const deltaOf = ({ a, b }: ComparisonPair) => ({
  diff: b - a,
  percent: a === 0 ? (b === 0 ? 0 : null) : (b - a) / Math.abs(a),
});
