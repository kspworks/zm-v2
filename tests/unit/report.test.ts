import { describe, expect, it } from "vitest";

import {
  buildComparison,
  buildReport,
  type ComparisonInput,
  colorSlots,
  DEBTS_KEY,
  deltaOf,
  NONE_KEY,
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
  accountId: "card",
  accountName: "Card",
  categoryId: null,
  categoryName: null,
  parentId: null,
  parentName: null,
  comment: null,
  counterpartyId: null,
  counterpartyName: null,
  debtLabel: null,
  ...overrides,
});

const labels = {
  noCategory: "No category",
  noCounterparty: "No counterparty",
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
      "category",
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

    expect(buildReport(rows, "expense", "category", labels)[0]?.total).toBe(
      100,
    );
    expect(buildReport(rows, "income", "category", labels)[0]?.total).toBe(400);
  });

  it("makes one chart per currency, largest total first, never mixing them", () => {
    const charts = buildReport(
      [
        row({ amount: -100, currencyCode: "USD", currencySign: "$" }),
        row({ amount: -5000 }),
        row({ amount: -200, currencyCode: "USD", currencySign: "$" }),
      ],
      "expense",
      "category",
      labels,
    );

    expect(charts.map((c) => [c.currencyCode, c.total])).toEqual([
      ["UAH", 5000],
      ["USD", 300],
    ]);
  });

  it("returns nothing for an empty view", () => {
    expect(
      buildReport([row({ amount: -1 })], "income", "category", labels),
    ).toEqual([]);
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
      "category",
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

    const [expense] = buildReport(rows, "expense", "category", labels);
    expect(expense?.tiles.map((t) => [t.key, t.name, t.value])).toEqual([
      [DEBTS_KEY, "Debts", 500],
      [NONE_KEY, "No category", 50],
    ]);
    expect(
      expense?.tiles[0]?.children.map((c) => [c.name, c.category]),
    ).toEqual([
      ["lent Alex", "lent Alex"],
      ["for the tickets", "lent Sam"],
    ]);

    const [income] = buildReport(rows, "income", "category", labels);
    expect(income?.tiles.map((t) => [t.name, t.value])).toEqual([
      ["Debts", 700],
    ]);
    expect(colorSlots([income as ReportChart], 8).get(DEBTS_KEY)).toBe(1);
  });

  it("groups by the account, debts on their real account", () => {
    const [chart] = buildReport(
      [
        row({ amount: -300, categoryId: "food", categoryName: "Food" }),
        row({ amount: -100, accountId: "cash", accountName: "Cash" }),
        row({
          kind: "debt",
          amount: -200,
          counterpartyId: "alex",
          counterpartyName: "Alex",
        }),
      ],
      "expense",
      "account",
      labels,
    );

    expect(chart?.tiles.map((t) => [t.key, t.name, t.value])).toEqual([
      ["card", "Card", 500],
      ["cash", "Cash", 100],
    ]);
    expect(chart?.tiles[0]?.children.map((c) => c.category)).toEqual([
      "Food",
      "? Alex",
    ]);
  });

  it("groups by the counterparty, debts included, the rest apart", () => {
    const [chart] = buildReport(
      [
        row({ amount: -300, counterpartyId: "alex", counterpartyName: "Alex" }),
        row({
          kind: "debt",
          amount: -200,
          counterpartyId: "alex",
          counterpartyName: "Alex",
        }),
        row({ amount: -400, categoryId: "food", categoryName: "Food" }),
        row({ amount: -100, counterpartyId: "sam", counterpartyName: "Sam" }),
      ],
      "expense",
      "counterparty",
      labels,
    );

    expect(chart?.tiles.map((t) => [t.key, t.name, t.value])).toEqual([
      ["alex", "Alex", 500],
      [NONE_KEY, "No counterparty", 400],
      ["sam", "Sam", 100],
    ]);
    expect(colorSlots([chart as ReportChart], 8).has(NONE_KEY)).toBe(false);
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
          [NONE_KEY, 1000],
          ["food", 10],
        ]),
      ],
      8,
    );

    expect(slots.has(NONE_KEY)).toBe(false);
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

let m = 0;
const total = (overrides: Partial<ComparisonInput>): ComparisonInput => ({
  currencyCode: "UAH",
  currencySign: "₴",
  isDebt: false,
  categoryId: `c${++m}`,
  categoryName: null,
  parentId: null,
  parentName: null,
  incomes: 0,
  expenses: 0,
  ...overrides,
});

const comparisonLabels = { noCategory: "No category", debts: "Debts" };

describe("buildComparison", () => {
  it("rolls children up under their parent and lists them when expanded", () => {
    const [table] = buildComparison(
      [
        total({
          categoryId: "cafe",
          categoryName: "Cafés",
          parentId: "food",
          parentName: "Food",
          expenses: -300,
        }),
        total({ categoryId: "food", categoryName: "Food", expenses: -200 }),
      ],
      [
        total({
          categoryId: "cafe",
          categoryName: "Cafés",
          parentId: "food",
          parentName: "Food",
          expenses: -100,
        }),
      ],
      comparisonLabels,
    );

    expect(table?.expense.rows).toEqual([
      {
        key: "food",
        name: "Food",
        a: 500,
        b: 100,
        children: [
          { key: "cafe", name: "Cafés", a: 300, b: 100, children: [] },
          { key: "food", name: "Food", a: 200, b: 0, children: [] },
        ],
      },
    ]);
    expect(table?.expense.total).toEqual({ a: 500, b: 100 });
  });

  it("puts a category in both sections, debts and no category last", () => {
    const [table] = buildComparison(
      [
        total({
          categoryId: "gift",
          categoryName: "Gifts",
          incomes: 50,
          expenses: -20,
        }),
        total({ categoryId: null, expenses: -900 }),
        total({ categoryId: null, isDebt: true, incomes: 1000 }),
      ],
      [total({ categoryId: "rent", categoryName: "Rent", expenses: -10 })],
      comparisonLabels,
    );

    expect(table?.income.rows.map((r) => [r.key, r.a, r.b])).toEqual([
      ["gift", 50, 0],
      [DEBTS_KEY, 1000, 0],
    ]);
    expect(table?.expense.rows.map((r) => [r.key, r.name, r.a, r.b])).toEqual([
      ["gift", "Gifts", 20, 0],
      ["rent", "Rent", 0, 10],
      [NONE_KEY, "No category", 900, 0],
    ]);
    // a row that is its own only leaf has nothing to expand
    expect(table?.income.rows[1]?.children).toEqual([]);
    expect(table?.remainder).toEqual({ a: 1050 - 920, b: -10 });
  });

  it("keeps currencies apart, the largest first", () => {
    const tables = buildComparison(
      [
        total({ currencyCode: "USD", currencySign: "$", expenses: -10 }),
        total({ expenses: -5000 }),
      ],
      [total({ currencyCode: "USD", currencySign: "$", incomes: 20 })],
      comparisonLabels,
    );

    expect(
      tables.map((x) => [x.currencyCode, x.income.total, x.expense.total]),
    ).toEqual([
      ["UAH", { a: 0, b: 0 }, { a: 5000, b: 0 }],
      ["USD", { a: 0, b: 20 }, { a: 10, b: 0 }],
    ]);
  });
});

describe("deltaOf", () => {
  it("is B minus A, relative to A, and null for a new value", () => {
    expect(deltaOf({ a: 200, b: 150 })).toEqual({ diff: -50, percent: -0.25 });
    expect(deltaOf({ a: 0, b: 150 })).toEqual({ diff: 150, percent: null });
    expect(deltaOf({ a: 0, b: 0 })).toEqual({ diff: 0, percent: 0 });
    // a negative remainder that grows is an increase
    expect(deltaOf({ a: -100, b: 50 })).toEqual({ diff: 150, percent: 1.5 });
  });
});
