import { describe, expect, it } from "vitest";

import {
  amountFilterRange,
  formatMoney,
  minorToInput,
  parseAmountInput,
  splitMoney,
} from "~/lib/money";

describe("formatMoney", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [123456789, "1 234 567.89"],
    [-100000, "-1 000.00"],
    [99999999999, "999 999 999.99"],
  ])("formats %d as %s", (minor, text) => {
    expect(formatMoney(minor)).toBe(text);
  });

  it("puts the currency sign after the number", () => {
    expect(formatMoney(-150, "₴")).toBe("-1.50 ₴");
  });

  it("shows a plus sign on request", () => {
    expect(formatMoney(150, "$", { showPlus: true })).toBe("+1.50 $");
    expect(formatMoney(0, "$", { showPlus: true })).toBe("0.00 $");
  });

  it("splits into parts", () => {
    expect(splitMoney(-123456)).toEqual({
      sign: "-",
      integral: "1 234",
      fraction: "56",
    });
  });
});

describe("parseAmountInput", () => {
  it.each([
    ["100", 10000],
    ["100.5", 10050],
    ["100,05", 10005],
    ["1 234,56", 123456],
    ["0.01", 1],
    ["999999999.99", 99999999999],
    ["12.", 1200],
  ])("parses %s", (input, minor) => {
    expect(parseAmountInput(input)).toBe(minor);
  });

  it.each([
    ["1.234"],
    ["1234567890"],
    ["abc"],
    [""],
    ["-"],
    ["1,2,3"],
    ["1e5"],
  ])("rejects %s", (input) => {
    expect(parseAmountInput(input)).toBeNull();
  });

  it("accepts a sign only when allowed", () => {
    expect(parseAmountInput("-5")).toBeNull();
    expect(parseAmountInput("-5", { allowSign: true })).toBe(-500);
    expect(parseAmountInput("+5,5", { allowSign: true })).toBe(550);
  });
});

describe("minorToInput", () => {
  it.each([
    [10000, "100"],
    [10050, "100.5"],
    [10005, "100.05"],
    [-250, "-2.5"],
  ])("renders %d as %s", (minor, text) => {
    expect(minorToInput(minor)).toBe(text);
  });
});

describe("amountFilterRange", () => {
  it("matches the whole unit when there are no decimals", () => {
    expect(amountFilterRange("100")).toEqual({ min: 10000, max: 10099 });
  });

  it("matches exact cents when there are decimals", () => {
    expect(amountFilterRange("100.5")).toEqual({ min: 10050, max: 10050 });
    expect(amountFilterRange("100,00")).toEqual({ min: 10000, max: 10000 });
  });

  it("rejects invalid input", () => {
    expect(amountFilterRange("x")).toBeNull();
  });
});
