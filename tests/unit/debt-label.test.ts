import { describe, expect, it } from "vitest";

import { debtLabel } from "~/lib/debt-label";

// the debt-account leg: +X means "I gave X", -X means "I took X"
describe("debtLabel: I gave X", () => {
  it("B >= 0: I lent X", () => {
    expect(debtLabel(0, 500)).toEqual({
      parts: [{ kind: "lent", amount: 500 }],
      settles: false,
    });
    expect(debtLabel(300, 500)).toEqual({
      parts: [{ kind: "lent", amount: 500 }],
      settles: false,
    });
  });

  it("B <= -X: I repaid X", () => {
    expect(debtLabel(-800, 500)).toEqual({
      parts: [{ kind: "repaid", amount: 500 }],
      settles: false,
    });
  });

  it("B = -X: I repaid X and settled", () => {
    expect(debtLabel(-500, 500)).toEqual({
      parts: [{ kind: "repaid", amount: 500 }],
      settles: true,
    });
  });

  it("-X < B < 0: split into repaid |B| and lent X - |B|", () => {
    expect(debtLabel(-300, 500)).toEqual({
      parts: [
        { kind: "repaid", amount: 300 },
        { kind: "lent", amount: 200 },
      ],
      settles: false,
    });
  });
});

describe("debtLabel: I took X", () => {
  it("B <= 0: I borrowed X", () => {
    expect(debtLabel(0, -500)).toEqual({
      parts: [{ kind: "borrowed", amount: 500 }],
      settles: false,
    });
    expect(debtLabel(-100, -500)).toEqual({
      parts: [{ kind: "borrowed", amount: 500 }],
      settles: false,
    });
  });

  it("B >= X: they repaid me X", () => {
    expect(debtLabel(900, -500)).toEqual({
      parts: [{ kind: "repaidToMe", amount: 500 }],
      settles: false,
    });
  });

  it("B = X: they repaid me X and settled", () => {
    expect(debtLabel(500, -500)).toEqual({
      parts: [{ kind: "repaidToMe", amount: 500 }],
      settles: true,
    });
  });

  it("0 < B < X: split into repaid me B and borrowed X - B", () => {
    expect(debtLabel(300, -500)).toEqual({
      parts: [
        { kind: "repaidToMe", amount: 300 },
        { kind: "borrowed", amount: 200 },
      ],
      settles: false,
    });
  });
});
