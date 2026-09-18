/**
 * Money is an integer in minor units (cents). Display: space thousands
 * separator, period decimals, currency sign after the number:
 * "-1 234 567.89 ₴". Input: "," or "." as decimal separator, at most 2
 * decimals and 9 integer digits.
 */

export const MAX_INTEGER_DIGITS = 9;

const groupThousands = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export type MoneyParts = {
  sign: "-" | "+" | "";
  integral: string;
  fraction: string;
};

export const splitMoney = (
  minor: number,
  { showPlus = false }: { showPlus?: boolean } = {},
): MoneyParts => {
  const abs = Math.abs(Math.trunc(minor));

  return {
    sign: minor < 0 ? "-" : showPlus && minor > 0 ? "+" : "",
    integral: groupThousands(String(Math.floor(abs / 100))),
    fraction: String(abs % 100).padStart(2, "0"),
  };
};

export const formatMoney = (
  minor: number,
  currencySign?: string | null,
  options: { showPlus?: boolean } = {},
): string => {
  const { sign, integral, fraction } = splitMoney(minor, options);
  const number = `${sign}${integral}.${fraction}`;

  return currencySign ? `${number} ${currencySign}` : number;
};

/** Plain decimal text for an input, e.g. 123456 -> "1234.56" */
export const minorToInput = (minor: number): string => {
  const abs = Math.abs(minor);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  const trimmed = text.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");

  return minor < 0 ? `-${trimmed}` : trimmed;
};

const AMOUNT_PATTERN = /^([+-]?)(\d{1,9})(?:[.,](\d{0,2}))?$/;

/**
 * Parses user input into minor units. Spaces are ignored, "," and "." both
 * work as the decimal separator. Returns null for anything invalid (more than
 * 2 decimals, more than 9 integer digits, letters, a lone sign).
 */
export const parseAmountInput = (
  value: string,
  { allowSign = false }: { allowSign?: boolean } = {},
): number | null => {
  const compact = value.replace(/[\s ]/g, "");
  const match = AMOUNT_PATTERN.exec(compact);

  if (!match) {
    return null;
  }

  const [, sign = "", integral = "0", fraction = ""] = match;

  if (sign && !allowSign) {
    return null;
  }

  const minor =
    Number.parseInt(integral, 10) * 100 +
    Number.parseInt(fraction.padEnd(2, "0") || "0", 10);

  return sign === "-" ? -minor : minor;
};

/**
 * The amount filter: a value without decimals matches the whole unit ("100"
 * matches 100.00-100.99), a value with decimals matches the exact cents.
 */
export const amountFilterRange = (
  value: string,
): { min: number; max: number } | null => {
  const compact = value.replace(/[\s ]/g, "");
  const minor = parseAmountInput(compact);

  if (minor === null) {
    return null;
  }

  const hasDecimals = /[.,]\d/.test(compact);

  return hasDecimals
    ? { min: minor, max: minor }
    : { min: minor, max: minor + 99 };
};
