import { describe, expect, it } from "vitest";

import { buildReport, type ReportInput } from "~/lib/report";

let n = 0;
const row = (overrides: Partial<ReportInput>): ReportInput => ({
  id: String(++n),
  date: "2026-03-01",
  amount: -100,
  currencyCode: "UAH",
  currencySign: "₴",
  categoryId: null,
  categoryName: null,
  parentId: null,
  parentName: null,
  comment: null,
  ...overrides,
});

const labels = { noCategory: "No category" };

describe("buildReport", () => {
  it("rolls children up under their parent and sorts tiles by total", () => {
    const [chart] = buildReport(
      [
        row({
          amount: -500,
          categoryId: "rent",
          categoryName: "Rent",
          parentId: "home",
          parentName: "Home",
        }),
        row({ amount: -300, categoryId: "home", categoryName: "Home" }),
        row({ amount: -1000, categoryId: "food", categoryName: "Food" }),
        row({ amount: -50 }),
      ],
      "expense",
      labels,
    );

    expect(chart?.total).toBe(1850);
    expect(chart?.tiles.map((t) => [t.name, t.value])).toEqual([
      ["Food", 1000],
      ["Home", 800],
      ["No category", 50],
    ]);
    expect(chart?.tiles[1]?.children.map((c) => [c.value, c.category])).toEqual(
      [
        [500, "Home → Rent"],
        [300, "Home"],
      ],
    );
  });

  it("keeps expense and income apart instead of summing absolute values", () => {
    const rows = [
      row({ amount: -100, categoryId: "a", categoryName: "A" }),
      row({ amount: 400, categoryId: "a", categoryName: "A" }),
    ];

    expect(buildReport(rows, "expense", labels)[0]?.total).toBe(100);
    expect(buildReport(rows, "income", labels)[0]?.total).toBe(400);
  });

  it("makes one chart per currency, largest total first, never mixing them", () => {
    const charts = buildReport(
      [
        row({ amount: -100, currencyCode: "USD", currencySign: "$" }),
        row({ amount: -5000 }),
        row({ amount: -200, currencyCode: "USD", currencySign: "$" }),
      ],
      "expense",
      labels,
    );

    expect(charts.map((c) => [c.currencyCode, c.total])).toEqual([
      ["UAH", 5000],
      ["USD", 300],
    ]);
  });

  it("returns nothing for an empty view", () => {
    expect(buildReport([row({ amount: -1 })], "income", labels)).toEqual([]);
  });

  it("names leaves by comment, falling back to the category", () => {
    const [chart] = buildReport(
      [
        row({
          amount: -1,
          categoryId: "f",
          categoryName: "Food",
          comment: "bread",
        }),
        row({ amount: -2, categoryId: "f", categoryName: "Food" }),
      ],
      "expense",
      labels,
    );

    expect(chart?.tiles[0]?.children.map((c) => c.name)).toEqual([
      "Food",
      "bread",
    ]);
  });
});
