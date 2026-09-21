import { addDays, addMonths, format, parseISO } from "date-fns";

/** Chart range bounds, in days before and after today */
export const RANGE_MIN = 1;
export const RANGE_MAX = 90;
export const RANGE_DEFAULT = 14;

/** Months in the forecast table: the current one plus eight more */
export const FORECAST_MONTHS = 9;

/** Items listed per chart dot before "+N more" */
export const ITEMS_PER_DAY = 8;

/** Date columns in the nearest planned table */
export const NEAREST_DAYS = 10;

export const clampRange = (value: number): number =>
  Math.min(RANGE_MAX, Math.max(RANGE_MIN, Math.trunc(value) || RANGE_MIN));

/**
 * A pair (or single row) as the dashboard sees it: `net` is its effect on the
 * selected account set, i.e. the sum of its legs that sit on those accounts.
 * A same-currency transfer between two of them nets to its fee.
 */
export type DashboardEntry = {
  id: string;
  kind: "expense" | "income" | "transfer" | "debt";
  date: string;
  planned: boolean;
  net: number;
  category: string | null;
  comment: string | null;
  counterparty: string | null;
  fromAccount: string | null;
  toAccount: string | null;
};

export type DashboardItem = DashboardEntry & { overdue: boolean };

const iso = (date: Date) => format(date, "yyyy-MM-dd");

/** Planned rows due before today count as due today */
export const effectiveDate = (
  entry: { date: string; planned: boolean },
  today: string,
): string => (entry.planned && entry.date < today ? today : entry.date);

const byDay = (entries: DashboardEntry[], today: string) => {
  const days = new Map<string, DashboardItem[]>();

  for (const entry of entries) {
    if (entry.net === 0) {
      continue;
    }

    const date = effectiveDate(entry, today);
    const list = days.get(date) ?? [];
    list.push({ ...entry, overdue: date !== entry.date, date });
    days.set(date, list);
  }

  return days;
};

export type BalancePoint = {
  date: string;
  /** End-of-day balance from submitted rows; days up to today */
  actual: number | null;
  /** Projected end-of-day balance; days from today */
  planned: number | null;
  items: DashboardItem[];
  more: number;
};

/**
 * One point per day from start to end. `opening` is the balance before
 * start. Submitted rows dated after today are future too, so they only move
 * the planned line. On today the planned value is the actual one plus
 * everything still pending today (overdue rows included).
 */
export const buildBalanceSeries = ({
  opening,
  entries,
  start,
  end,
  today,
  cap = ITEMS_PER_DAY,
}: {
  opening: number;
  entries: DashboardEntry[];
  start: string;
  end: string;
  today: string;
  cap?: number;
}): BalancePoint[] => {
  const days = byDay(entries, today);
  const points: BalancePoint[] = [];
  let balance = opening;

  for (let d = parseISO(start); iso(d) <= end; d = addDays(d, 1)) {
    const date = iso(d);
    const items = days.get(date) ?? [];
    let actual: number | null = null;

    if (date <= today) {
      for (const item of items) {
        if (!item.planned && item.date <= today) {
          balance += item.net;
        }
      }

      actual = balance;
    }

    let planned: number | null = null;

    if (date >= today) {
      for (const item of items) {
        if (item.planned || date > today) {
          balance += item.net;
        }
      }

      planned = balance;
    }

    const sorted = [...items].sort(
      (a, b) =>
        Number(a.planned) - Number(b.planned) ||
        Math.abs(b.net) - Math.abs(a.net),
    );

    points.push({
      date,
      actual,
      planned,
      items: sorted.slice(0, cap),
      more: Math.max(0, sorted.length - cap),
    });
  }

  return points;
};

export type ForecastMonth = {
  /** "yyyy-MM" */
  month: string;
  income: number;
  expense: number;
  /** Projected balance at the end of the month */
  balance: number;
};

/** First and last day of the forecast window */
export const forecastWindow = (
  today: string,
  months = FORECAST_MONTHS,
): { start: string; end: string } => {
  const first = parseISO(`${today.slice(0, 7)}-01`);

  return {
    start: iso(first),
    end: iso(addDays(addMonths(first, months), -1)),
  };
};

/**
 * Income, expense and month-end balance for the current month and the next
 * ones. `opening` is the balance before the current month; every entry in the
 * window counts (submitted and planned), so each month reconciles:
 * balance = previous balance + income + expense.
 */
export const buildForecast = ({
  opening,
  entries,
  today,
  months = FORECAST_MONTHS,
}: {
  opening: number;
  entries: DashboardEntry[];
  today: string;
  months?: number;
}): ForecastMonth[] => {
  const { start } = forecastWindow(today, months);
  const first = parseISO(start);
  const rows: ForecastMonth[] = Array.from({ length: months }, (_, i) => ({
    month: format(addMonths(first, i), "yyyy-MM"),
    income: 0,
    expense: 0,
    balance: 0,
  }));
  const index = new Map(rows.map((row, i) => [row.month, i]));

  for (const entry of entries) {
    const i = index.get(effectiveDate(entry, today).slice(0, 7));
    const row = i === undefined ? undefined : rows[i];

    if (!row) {
      continue;
    }

    if (entry.net > 0) {
      row.income += entry.net;
    } else {
      row.expense += entry.net;
    }
  }

  let balance = opening;

  for (const row of rows) {
    balance += row.income + row.expense;
    row.balance = balance;
  }

  return rows;
};
