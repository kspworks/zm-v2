import { describe, expect, it } from "vitest";

import {
  accountTypeFromName,
  parseCsv,
  validateRows,
} from "~/server/lib/csv-import";
import { csvText, expenseRow } from "../helpers/csv";

const codes = ["UAH", "USD", "EUR", "GBP"];

describe("parseCsv", () => {
  it("skips the title line, reads the header on line 2 and skips empty lines", () => {
    const text = `${csvText([expenseRow(), expenseRow({ outcome: "5,50" })])}\n\n`;

    const rows = parseCsv(text);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      outcome: "5,50",
      outcomeAccountName: "Card",
    });
  });
});

describe("validateRows", () => {
  it("turns comma amounts into minor units and blanks into null", () => {
    const { rows, errors } = validateRows(
      parseCsv(csvText([expenseRow({ outcome: "3000,00", comment: "" })])),
      codes,
    );

    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      outcome: 300_000,
      income: null,
      comment: null,
      categoryName: "Food",
      line: 3,
    });
  });

  it("rejects a dot decimal instead of landing 100x too small", () => {
    const { errors } = validateRows(
      parseCsv(csvText([expenseRow({ outcome: "3000.00" })])),
      codes,
    );

    expect(errors).toEqual([
      { line: 3, field: "outcome", key: "is_minor_units" },
    ]);
  });

  it("reports every bad row, with its line", () => {
    const { rows, errors } = validateRows(
      parseCsv(
        csvText([
          expenseRow(),
          expenseRow({ outcomeCurrencyShortTitle: "XYZ" }),
          expenseRow({ date: "15.01.2025" }),
          expenseRow({ outcome: "", income: "" }),
        ]),
      ),
      codes,
    );

    expect(rows).toEqual([]);
    expect(errors).toEqual([
      { line: 4, field: "outcomeCurrencyShortTitle", key: "unknown_currency" },
      { line: 5, field: "date", key: "import_invalid" },
      { line: 6, field: "outcome", key: "import_empty_row" },
    ]);
  });

  it("treats a zero amount as absent", () => {
    const { rows } = validateRows(
      parseCsv(
        csvText([
          {
            outcomeAccountName: "Card",
            outcome: "0,00",
            outcomeCurrencyShortTitle: "UAH",
            incomeAccountName: "Card",
            income: "10,00",
            incomeCurrencyShortTitle: "UAH",
          },
        ]),
      ),
      codes,
    );

    expect(rows[0]).toMatchObject({ outcome: null, income: 1000 });
  });

  it("rejects comments over 500 chars", () => {
    const { errors } = validateRows(
      parseCsv(csvText([expenseRow({ comment: "x".repeat(501) })])),
      codes,
    );

    expect(errors).toEqual([
      { line: 3, field: "comment", key: "import_invalid" },
    ]);
  });
});

describe("the debt currency fix", () => {
  it("gives the debt side the other side's currency", () => {
    const { rows } = validateRows(
      parseCsv(
        csvText([
          {
            outcomeAccountName: "Cash",
            outcome: "100,00",
            outcomeCurrencyShortTitle: "USD",
            incomeAccountName: "Долги",
            income: "100,00",
            incomeCurrencyShortTitle: "UAH",
          },
          {
            outcomeAccountName: "Борги",
            outcome: "50,00",
            outcomeCurrencyShortTitle: "UAH",
            incomeAccountName: "Wallet",
            income: "50,00",
            incomeCurrencyShortTitle: "EUR",
          },
        ]),
      ),
      codes,
    );

    expect(rows[0]).toMatchObject({
      incomeCurrency: "USD",
      outcomeCurrency: "USD",
    });
    expect(rows[1]).toMatchObject({
      outcomeCurrency: "EUR",
      incomeCurrency: "EUR",
    });
  });

  it("leaves real cross-currency transfers alone", () => {
    const { rows } = validateRows(
      parseCsv(
        csvText([
          {
            outcomeAccountName: "Card",
            outcome: "4100,00",
            outcomeCurrencyShortTitle: "UAH",
            incomeAccountName: "Dollars",
            income: "100,00",
            incomeCurrencyShortTitle: "USD",
          },
        ]),
      ),
      codes,
    );

    expect(rows[0]).toMatchObject({
      outcomeCurrency: "UAH",
      incomeCurrency: "USD",
    });
  });
});

describe("accountTypeFromName", () => {
  it.each([
    ["Долги", "debt"],
    ["борги", "debt"],
    ["Debts", "debt"],
    ["Наличные", "cash"],
    ["ГОТІВКА", "cash"],
    ["cash", "cash"],
    ["Monobank", "card"],
  ])("%s → %s", (name, type) => {
    expect(accountTypeFromName(name)).toBe(type);
  });
});
