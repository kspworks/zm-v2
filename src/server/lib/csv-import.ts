import { parse as parseCsvSync } from "csv-parse/sync";

import type { ErrorKey } from "~/lib/error-keys";

/**
 * The ZenMoney export: a title on line 1, the header on line 2, comma
 * delimited. Amounts use a comma decimal with exactly two places and no
 * thousands separator ("3000,00"), so they are quoted.
 */
export const CSV_COLUMNS = [
  "date",
  "categoryName",
  "payee",
  "comment",
  "outcomeAccountName",
  "outcome",
  "outcomeCurrencyShortTitle",
  "incomeAccountName",
  "income",
  "incomeCurrencyShortTitle",
  "createdDate",
  "changedDate",
] as const;

/** The first data line in the file (line 1 is a title, line 2 the header) */
const FIRST_DATA_LINE = 3;

export type ImportRow = {
  line: number;
  date: string;
  categoryName: string | null;
  payee: string | null;
  comment: string | null;
  outcomeAccountName: string | null;
  outcome: number | null;
  outcomeCurrency: string | null;
  incomeAccountName: string | null;
  income: number | null;
  incomeCurrency: string | null;
  createdDate: string;
};

export type ImportRowError = { line: number; field: string; key: ErrorKey };

type RawRow = Partial<Record<(typeof CSV_COLUMNS)[number], string>>;

export const parseCsv = (text: string): RawRow[] =>
  parseCsvSync(text, {
    columns: true,
    skip_empty_lines: true,
    from_line: 2,
    trim: false,
    relax_column_count: true,
    bom: true,
  }) as RawRow[];

export type AccountKind = "debt" | "cash" | "card";

/** Account type from its name, case-insensitively */
export const accountTypeFromName = (name: string): AccountKind => {
  const lower = name.trim().toLocaleLowerCase();

  if (["долги", "борги", "debts"].includes(lower)) {
    return "debt";
  }

  if (["наличные", "готівка", "cash"].includes(lower)) {
    return "cash";
  }

  return "card";
};

const blank = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
};

/**
 * "3000,00" → 300000. Stripping the comma must leave a whole number: a
 * dot-decimal file would otherwise land 100× too small, so it's rejected.
 */
const parseAmount = (value: string | undefined): number | null | "invalid" => {
  const text = blank(value);

  if (text === null) {
    return null;
  }

  if (!/^\d+,\d{2}$/.test(text)) {
    return "invalid";
  }

  const minor = Number(text.replace(",", ""));

  return Number.isSafeInteger(minor) ? minor : "invalid";
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Validates the whole file before anything is written and returns every
 * row-level error at once. Also applies the debt currency fix.
 */
export const validateRows = (
  raw: RawRow[],
  currencyCodes: string[],
): { rows: ImportRow[]; errors: ImportRowError[] } => {
  const codes = new Set(currencyCodes);
  const rows: ImportRow[] = [];
  const errors: ImportRowError[] = [];

  for (const [index, source] of raw.entries()) {
    const line = index + FIRST_DATA_LINE;
    const fail = (field: string, key: ErrorKey) =>
      errors.push({ line, field, key });

    const date = blank(source.date) ?? "";
    if (!DATE.test(date) || Number.isNaN(Date.parse(date))) {
      fail("date", "import_invalid");
    }

    const createdDate = blank(source.createdDate) ?? "";
    if (!DATE_TIME.test(createdDate)) {
      fail("createdDate", "import_invalid");
    }

    const outcome = parseAmount(source.outcome);
    const income = parseAmount(source.income);
    if (outcome === "invalid") {
      fail("outcome", "is_minor_units");
    }
    if (income === "invalid") {
      fail("income", "is_minor_units");
    }

    const comment = blank(source.comment);
    if (comment && comment.length > 500) {
      fail("comment", "import_invalid");
    }

    const outcomeCurrency = blank(source.outcomeCurrencyShortTitle);
    const incomeCurrency = blank(source.incomeCurrencyShortTitle);
    if (outcomeCurrency && !codes.has(outcomeCurrency)) {
      fail("outcomeCurrencyShortTitle", "unknown_currency");
    }
    if (incomeCurrency && !codes.has(incomeCurrency)) {
      fail("incomeCurrencyShortTitle", "unknown_currency");
    }

    const out = typeof outcome === "number" && outcome > 0 ? outcome : null;
    const inc = typeof income === "number" && income > 0 ? income : null;
    const outcomeAccountName = blank(source.outcomeAccountName);
    const incomeAccountName = blank(source.incomeAccountName);

    if (outcome !== "invalid" && income !== "invalid" && !out && !inc) {
      fail("outcome", "import_empty_row");
    }

    if (out && (!outcomeAccountName || !outcomeCurrency)) {
      fail("outcomeAccountName", "import_invalid");
    }

    if (inc && (!incomeAccountName || !incomeCurrency)) {
      fail("incomeAccountName", "import_invalid");
    }

    rows.push({
      line,
      date,
      categoryName: blank(source.categoryName),
      payee: blank(source.payee),
      comment,
      outcomeAccountName: out ? outcomeAccountName : null,
      outcome: out,
      outcomeCurrency: out ? outcomeCurrency : null,
      incomeAccountName: inc ? incomeAccountName : null,
      income: inc,
      incomeCurrency: inc ? incomeCurrency : null,
      createdDate,
    });
  }

  return { rows: errors.length ? [] : rows.map(fixDebtCurrency), errors };
};

/**
 * ZenMoney sometimes writes a debt leg in the wrong currency. When both sides
 * carry the same amount in different currencies and one side is a debt
 * account, that side takes the other side's currency.
 */
export const fixDebtCurrency = (row: ImportRow): ImportRow => {
  if (
    row.outcome === null ||
    row.income === null ||
    row.outcome !== row.income ||
    row.outcomeCurrency === row.incomeCurrency
  ) {
    return row;
  }

  if (
    row.incomeAccountName &&
    accountTypeFromName(row.incomeAccountName) === "debt"
  ) {
    logFix(row, "income");

    return { ...row, incomeCurrency: row.outcomeCurrency };
  }

  if (
    row.outcomeAccountName &&
    accountTypeFromName(row.outcomeAccountName) === "debt"
  ) {
    logFix(row, "outcome");

    return { ...row, outcomeCurrency: row.incomeCurrency };
  }

  return row;
};

const logFix = (row: ImportRow, side: "income" | "outcome") => {
  if (process.env.NODE_ENV !== "test") {
    // biome-ignore lint/suspicious/noConsole: import diagnostics
    console.log(
      `[CSV][WARN] line ${row.line}: fixed the ${side} debt currency`,
    );
  }
};
