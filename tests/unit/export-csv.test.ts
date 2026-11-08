import { describe, expect, it } from "vitest";

import { decimalAmount, transactionsCsv } from "~/lib/export-csv";

describe("export csv", () => {
  it("writes minor units as plain decimals", () => {
    expect(decimalAmount(-123450)).toBe("-1234.50");
    expect(decimalAmount(5)).toBe("0.05");
    expect(decimalAmount(-99)).toBe("-0.99");
  });

  it("quotes commas and quotes, and defuses formulas", () => {
    const csv = transactionsCsv([
      {
        date: "2026-03-01",
        kind: "expense",
        amount: -100,
        currencyCode: "UAH",
        accountName: 'Card, "main"',
        accountType: "card",
        categoryName: "Rent",
        parentName: "House",
        counterpartyName: "@me",
        comment: "+1 line",
        batchId: null,
      },
    ]);

    expect(csv.split("\r\n")[1]).toBe(
      `2026-03-01,expense,-1.00,UAH,"Card, ""main""",card,House,Rent,'@me,'+1 line,`,
    );
  });
});
