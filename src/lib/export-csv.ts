/** One stored leg; a transfer or a debt is two rows sharing `batchId` */
export type ExportRow = {
  date: string;
  kind: string;
  amount: number;
  currencyCode: string;
  accountName: string;
  accountType: string;
  categoryName: string | null;
  parentName: string | null;
  counterpartyName: string | null;
  comment: string | null;
  batchId: string | null;
};

const HEADER = [
  "date",
  "kind",
  "amount",
  "currency",
  "account",
  "account_type",
  "category",
  "subcategory",
  "counterparty",
  "comment",
  "batch_id",
];

/** Minor units as a plain decimal, whatever the locale: "-1234.50" */
export const decimalAmount = (minor: number) => {
  const digits = String(Math.abs(minor)).padStart(3, "0");

  return `${minor < 0 ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};

/**
 * Quotes a cell when CSV needs it. Free text that a spreadsheet would run as a
 * formula gets a leading apostrophe, so an exported comment can't execute.
 */
const textCell = (value: string | null) => {
  const text = value ?? "";
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const transactionsCsv = (rows: readonly ExportRow[]) =>
  [
    HEADER.join(","),
    ...rows.map((row) =>
      [
        row.date,
        row.kind,
        decimalAmount(row.amount),
        row.currencyCode,
        textCell(row.accountName),
        row.accountType,
        textCell(row.parentName ?? row.categoryName),
        textCell(row.parentName ? row.categoryName : null),
        textCell(row.counterpartyName),
        textCell(row.comment),
        row.batchId ?? "",
      ].join(","),
    ),
    "",
  ].join("\r\n");
