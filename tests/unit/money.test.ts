import { describe, expect, it } from "vitest";

import {
  amountFilterRange,
  evaluateAmount,
  formatMoney,
  isAmountExpression,
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

describe("evaluateAmount", () => {
  it.each([
    ["150", 15000],
    ["1 234,5", 123450],
    ["120+35,5", 15550],
    ["120 + 35.5", 15550],
    ["100-20.25", 7975],
    ["3*49.90", 14970],
    ["2+3*4", 1400],
    ["(2+3)*4", 2000],
    ["(100-20)/2", 4000],
    ["10/3", 333],
    ["20/3", 667],
    ["10/3*3", 1000],
    ["0.1+0.2", 30],
    ["0.5*0.01", 1],
    ["12×3", 3600],
    ["12÷4", 300],
    ["10−4", 600],
  ])("calculates %s as %d", (text, minor) => {
    expect(evaluateAmount(text)).toBe(minor);
  });

  it.each([
    "",
    "abc",
    "5+",
    "5++3",
    "*5",
    "(5+3",
    "5+3)",
    "5(3)",
    "1.234",
    "10/0",
    "5/(3-3)",
    "1234567890",
    "999999999+1",
  ])("refuses %j", (text) => {
    expect(evaluateAmount(text)).toBeNull();
  });

  it("refuses a negative result unless a sign is allowed", () => {
    expect(evaluateAmount("20-50")).toBeNull();
    expect(evaluateAmount("20-50", { allowSign: true })).toBe(-3000);
  });

  it("reads a leading minus as a sign only with allowSign", () => {
    expect(evaluateAmount("-5+3", { allowSign: true })).toBe(-200);
    expect(evaluateAmount("-5*2", { allowSign: true })).toBe(-1000);
    expect(evaluateAmount("+5", { allowSign: true })).toBe(500);
    expect(evaluateAmount("-5")).toBeNull();
  });

  it("continues the previous value after a leading operator", () => {
    expect(evaluateAmount("+50", { base: 10000 })).toBe(15000);
    expect(evaluateAmount("-30", { base: 10000 })).toBe(7000);
    expect(evaluateAmount("*2", { base: 10000 })).toBe(20000);
    expect(evaluateAmount("/4", { base: 10000 })).toBe(2500);
    // with a sign allowed, a leading minus is the sign
    expect(evaluateAmount("-30", { allowSign: true, base: 10000 })).toBe(-3000);
  });
});

describe("isAmountExpression", () => {
  it.each([
    ["120", false],
    ["1 234,50", false],
    ["", false],
    ["120+35", true],
    ["(5)", true],
    ["+50", true],
    ["-5", true],
  ])("%j → %s", (text, expected) => {
    expect(isAmountExpression(text)).toBe(expected);
  });

  it("treats a leading sign as a sign where one is allowed", () => {
    expect(isAmountExpression("-5", { allowSign: true })).toBe(false);
    expect(isAmountExpression("-5-3", { allowSign: true })).toBe(true);
  });
});
