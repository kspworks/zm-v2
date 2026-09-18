import { describe, expect, it } from "vitest";

import { categoryOptions } from "~/lib/category-options";

const categories = [
  { id: "1", name: "Home", parentId: null, isExpense: true, isIncome: false },
  { id: "2", name: "Repair", parentId: "1", isExpense: true, isIncome: false },
  { id: "3", name: "Salary", parentId: null, isExpense: false, isIncome: true },
  {
    id: "4",
    name: "Adjustment",
    parentId: null,
    isExpense: true,
    isIncome: true,
  },
  { id: "5", name: "Rent", parentId: "1", isExpense: true, isIncome: false },
];

describe("categoryOptions", () => {
  it("labels children Parent → Child and sorts by label", () => {
    expect(categoryOptions(categories, "en").map((o) => o.label)).toEqual([
      "Adjustment",
      "Home",
      "Home → Rent",
      "Home → Repair",
      "Salary",
    ]);
  });

  it("filters by kind", () => {
    expect(
      categoryOptions(categories, "en", "income").map((o) => o.label),
    ).toEqual(["Adjustment", "Salary"]);
    expect(
      categoryOptions(categories, "en", "expense").map((o) => o.id),
    ).not.toContain("3");
  });
});
