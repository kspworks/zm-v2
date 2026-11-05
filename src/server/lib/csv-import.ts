import { parse as parseCsvSync } from "csv-parse/sync";
import { Cause, Exit, Schema, SchemaIssue, SchemaTransformation } from "effect";

import { type ErrorKey, isErrorKey } from "~/lib/error-keys";
import { message } from "~/lib/validators/common";

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

/** A cell: absent or whitespace-only reads as null, anything else trimmed */
const Cell = Schema.UndefinedOr(Schema.String).pipe(
  Schema.decodeTo(
    Schema.NullOr(Schema.String),
    SchemaTransformation.transform<string | null, string | undefined>({
      decode: blank,
      encode: (value) => value ?? undefined,
    }),
  ),
);

/** A cell that is empty or passes `test`, else fails with `key` */
const checkedCell = (test: (value: string) => boolean, key: ErrorKey) =>
  Cell.check(
    Schema.makeFilter(
      (value: string | null) => value === null || test(value),
      message(key),
    ),
  );

/** A required cell matching `pattern` */
const requiredCell = (
  pattern: RegExp,
  key: ErrorKey,
  extra: (value: string) => boolean = () => true,
) =>
  Cell.check(
    Schema.makeFilter(
      (value: string | null) =>
        value !== null && pattern.test(value) && extra(value),
      message(key),
    ),
  ).pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transform<string, string | null>({
        decode: (value) => value ?? "",
        encode: (value) => value,
      }),
    ),
  );

const DateCell = requiredCell(
  /^\d{4}-\d{2}-\d{2}$/,
  "import_invalid",
  (value) => !Number.isNaN(Date.parse(value)),
);

const DateTimeCell = requiredCell(
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
  "import_invalid",
);

/**
 * "3000,00" → 300000; an empty cell is null. Stripping the comma must leave a
 * whole number: a dot-decimal file would otherwise land 100× too small, so
 * it's rejected.
 */
const AmountCell = checkedCell(
  (value) =>
    /^\d+,\d{2}$/.test(value) &&
    Number.isSafeInteger(Number(value.replace(",", ""))),
  "is_minor_units",
).pipe(
  Schema.decodeTo(
    Schema.NullOr(Schema.Int),
    SchemaTransformation.transform<number | null, string | null>({
      decode: (value) =>
        value === null ? null : Number(value.replace(",", "")),
      encode: (value) =>
        value === null ? null : (value / 100).toFixed(2).replace(".", ","),
    }),
  ),
);

const CommentCell = checkedCell(
  (value) => value.length <= 500,
  "import_invalid",
);

const currencyCell = (codes: ReadonlySet<string>) =>
  checkedCell((value) => codes.has(value), "unknown_currency");

/** Decodes one cell; on failure, the app error key its schema carries */
const decodeCell = <T>(
  schema: Schema.Decoder<T>,
  value: string | undefined,
): { value: T } | { key: ErrorKey } => {
  const exit = Schema.decodeUnknownExit(schema)(value);

  if (Exit.isSuccess(exit)) {
    return { value: exit.value };
  }

  const error = Cause.squash(exit.cause);
  const issue = Schema.isSchemaError(error)
    ? formatIssue(error.issue).issues[0]
    : undefined;

  return { key: isErrorKey(issue?.message) ? issue.message : "import_invalid" };
};

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * Validates the whole file before anything is written and returns every
 * row-level error at once. Each cell is decoded by its own schema, so a row
 * reports every bad cell; the rules across cells follow. Also applies the
 * debt currency fix.
 */
export const validateRows = (
  raw: RawRow[],
  currencyCodes: string[],
): { rows: ImportRow[]; errors: ImportRowError[] } => {
  const CurrencyCell = currencyCell(new Set(currencyCodes));
  const rows: ImportRow[] = [];
  const errors: ImportRowError[] = [];

  for (const [index, source] of raw.entries()) {
    const line = index + FIRST_DATA_LINE;
    const cell = <T>(
      field: (typeof CSV_COLUMNS)[number],
      schema: Schema.Decoder<T>,
      fallback: T,
    ): { ok: boolean; value: T } => {
      const result = decodeCell(schema, source[field]);

      if ("key" in result) {
        errors.push({ line, field, key: result.key });

        return { ok: false, value: fallback };
      }

      return { ok: true, value: result.value };
    };

    const date = cell("date", DateCell, blank(source.date) ?? "").value;
    const createdDate = cell(
      "createdDate",
      DateTimeCell,
      blank(source.createdDate) ?? "",
    ).value;
    const outcome = cell("outcome", AmountCell, null);
    const income = cell("income", AmountCell, null);
    const comment = cell("comment", CommentCell, blank(source.comment)).value;
    const outcomeCurrency = cell(
      "outcomeCurrencyShortTitle",
      CurrencyCell,
      blank(source.outcomeCurrencyShortTitle),
    ).value;
    const incomeCurrency = cell(
      "incomeCurrencyShortTitle",
      CurrencyCell,
      blank(source.incomeCurrencyShortTitle),
    ).value;

    const out =
      outcome.value !== null && outcome.value > 0 ? outcome.value : null;
    const inc = income.value !== null && income.value > 0 ? income.value : null;
    const outcomeAccountName = blank(source.outcomeAccountName);
    const incomeAccountName = blank(source.incomeAccountName);

    if (outcome.ok && income.ok && !out && !inc) {
      errors.push({ line, field: "outcome", key: "import_empty_row" });
    }

    if (out && (!outcomeAccountName || !outcomeCurrency)) {
      errors.push({ line, field: "outcomeAccountName", key: "import_invalid" });
    }

    if (inc && (!incomeAccountName || !incomeCurrency)) {
      errors.push({ line, field: "incomeAccountName", key: "import_invalid" });
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
