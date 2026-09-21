import { describe, expect, it } from "vitest";

import {
  buildReport,
  colorSlots,
  DEBTS_KEY,
  NO_CATEGORY_KEY,
  type ReportChart,
  type ReportInput,
} from "~/lib/report";

let n = 0;
const row = (overrides: Partial<ReportInput>): ReportInput => ({
  id: String(++n),
  kind: "expense",
  date: "2026-03-01",
  amount: -100,
  currencyCode: "UAH",
  currencySign: "₴",
  categoryId: null,
  categoryName: null,
  parentId: null,
  parentName: null,
  comment: null,
  counterpartyName: null,
  debtLabel: null,
  ...overrides,
});

const labels = {
  noCategory: "No category",
  debts: "Debts",
  debtDescription: (r: ReportInput) =>
    `${r.debtLabel?.parts[0]?.kind ?? "?"} ${r.counterpartyName ?? ""}`,
};

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

  it("puts debt pairs in one Debts tile, described by their wording", () => {
    const debt = (amount: number, name: string, comment: string | null) =>
      row({
        kind: "debt",
        amount,
        counterpartyName: name,
        comment,
        debtLabel: {
          parts: [{ kind: amount < 0 ? "lent" : "borrowed", amount: -amount }],
          settles: false,
        },
      });
    const rows = [
      debt(-300, "Alex", null),
      debt(-200, "Sam", "for the tickets"),
      debt(700, "Alex", null),
      row({ amount: -50 }),
    ];

    const [expense] = buildReport(rows, "expense", labels);
    expect(expense?.tiles.map((t) => [t.key, t.name, t.value])).toEqual([
      [DEBTS_KEY, "Debts", 500],
      [NO_CATEGORY_KEY, "No category", 50],
    ]);
    expect(
      expense?.tiles[0]?.children.map((c) => [c.name, c.category]),
    ).toEqual([
      ["lent Alex", "lent Alex"],
      ["for the tickets", "lent Sam"],
    ]);

    const [income] = buildReport(rows, "income", labels);
    expect(income?.tiles.map((t) => [t.name, t.value])).toEqual([
      ["Debts", 700],
    ]);
    expect(colorSlots([income as ReportChart], 8).get(DEBTS_KEY)).toBe(1);
  });
});

const chart = (
  currencyCode: string,
  tiles: [key: string, value: number][],
): ReportChart => ({
  currencyCode,
  currencySign: "",
  total: tiles.reduce((sum, [, value]) => sum + value, 0),
  tiles: tiles.map(([key, value]) => ({
    key,
    name: key,
    value,
    children: [],
  })),
});

describe("colorSlots", () => {
  it("gives slots to the largest tiles in size order and none past the limit", () => {
    const slots = colorSlots(
      [
        chart("UAH", [
          ["rent", 900],
          ["food", 500],
          ["fun", 300],
          ["misc", 100],
        ]),
      ],
      2,
    );

    expect([...slots.entries()]).toEqual([
      ["rent", 1],
      ["food", 2],
    ]);
  });

  it("never gives a slot to the no-category tile", () => {
    const slots = colorSlots(
      [
        chart("UAH", [
          [NO_CATEGORY_KEY, 1000],
          ["food", 10],
        ]),
      ],
      8,
    );

    expect(slots.has(NO_CATEGORY_KEY)).toBe(false);
    expect(slots.get("food")).toBe(1);
  });

  it("sums a category across currencies", () => {
    const slots = colorSlots(
      [
        chart("UAH", [
          ["rent", 600],
          ["food", 500],
        ]),
        chart("USD", [["food", 200]]),
      ],
      8,
    );

    expect(slots.get("food")).toBe(1);
    expect(slots.get("rent")).toBe(2);
  });

  it("breaks ties by key", () => {
    const slots = colorSlots(
      [
        chart("UAH", [
          ["b", 100],
          ["a", 100],
        ]),
      ],
      8,
    );

    expect(slots.get("a")).toBe(1);
    expect(slots.get("b")).toBe(2);
  });
});
