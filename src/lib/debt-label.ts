/**
 * Debt wording. Given B, the running balance with the
 * counterparty in this currency just *before* the entry (positive: they owe
 * me), and the entry's debt-account leg (positive: "I gave"), decide between
 * lent / borrowed / repaid / repaid-to-me, splitting when the entry crosses
 * zero.
 */
export type DebtPartKind = "lent" | "borrowed" | "repaid" | "repaidToMe";

export type DebtLabel = {
  parts: { kind: DebtPartKind; amount: number }[];
  /** The entry brings the balance back to exactly zero */
  settles: boolean;
};

export const debtLabel = (
  balanceBefore: number,
  debtLegAmount: number,
): DebtLabel => {
  const b = balanceBefore;
  const x = Math.abs(debtLegAmount);
  const settles = b !== 0 && b + debtLegAmount === 0;

  if (debtLegAmount > 0) {
    // I gave x
    if (b >= 0) {
      return { parts: [{ kind: "lent", amount: x }], settles };
    }

    if (b <= -x) {
      return { parts: [{ kind: "repaid", amount: x }], settles };
    }

    return {
      parts: [
        { kind: "repaid", amount: -b },
        { kind: "lent", amount: x + b },
      ],
      settles,
    };
  }

  // I took x
  if (b <= 0) {
    return { parts: [{ kind: "borrowed", amount: x }], settles };
  }

  if (b >= x) {
    return { parts: [{ kind: "repaidToMe", amount: x }], settles };
  }

  return {
    parts: [
      { kind: "repaidToMe", amount: b },
      { kind: "borrowed", amount: x - b },
    ],
    settles,
  };
};
