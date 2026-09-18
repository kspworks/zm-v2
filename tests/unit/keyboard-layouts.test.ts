import { describe, expect, it } from "vitest";

import { layoutVariants, matchesAnyLayout } from "~/lib/keyboard-layouts";

describe("keyboard-layout-agnostic search", () => {
  it("finds Ukrainian text typed with the English layout", () => {
    expect(matchesAnyLayout("Продукти", "ghj")).toBe(true);
    expect(matchesAnyLayout("Продукти", "GHJ")).toBe(true);
  });

  it("finds English text typed with the Ukrainian layout", () => {
    expect(matchesAnyLayout("Groceries", "пкщ")).toBe(true);
  });

  it("maps the Ukrainian-specific keys", () => {
    // ] is Ї, ' is Є, \ is ʼ on the Ukrainian layout
    expect(layoutVariants("]'")).toContain("їє");
    expect(matchesAnyLayout("Здоровʼя", "pljhjd\\")).toBe(true);
  });

  it("still matches plain substrings, case-insensitively", () => {
    expect(matchesAnyLayout("Home → Repair", "repa")).toBe(true);
    expect(matchesAnyLayout("Дім → Ремонт", "ремонт")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesAnyLayout("Продукти", "xyz")).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(matchesAnyLayout("Anything", "  ")).toBe(true);
  });
});
