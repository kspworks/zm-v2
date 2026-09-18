import { CSV_COLUMNS } from "~/server/lib/csv-import";

export type CsvRow = Partial<Record<(typeof CSV_COLUMNS)[number], string>>;

const DEFAULTS: Record<(typeof CSV_COLUMNS)[number], string> = {
  date: "2025-01-15",
  categoryName: "",
  payee: "",
  comment: "",
  outcomeAccountName: "",
  outcome: "",
  outcomeCurrencyShortTitle: "",
  incomeAccountName: "",
  income: "",
  incomeCurrencyShortTitle: "",
  createdDate: "2025-01-15 10:00:00",
  changedDate: "2025-01-15 10:00:00",
};

/** Comma-decimal amounts collide with the comma delimiter, so quote them */
const quote = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** A ZenMoney-shaped file: title line, header line, rows */
export const csvText = (rows: CsvRow[]): string =>
  [
    "Отчёт по операциям",
    CSV_COLUMNS.join(","),
    ...rows.map((row) =>
      CSV_COLUMNS.map((column) => quote(row[column] ?? DEFAULTS[column])).join(
        ",",
      ),
    ),
  ].join("\n");

export const buildCsv = (rows: CsvRow[]): string =>
  Buffer.from(csvText(rows)).toString("base64");

export const expenseRow = (overrides: CsvRow = {}): CsvRow => ({
  categoryName: "Food",
  outcomeAccountName: "Card",
  outcome: "100,00",
  outcomeCurrencyShortTitle: "UAH",
  ...overrides,
});
