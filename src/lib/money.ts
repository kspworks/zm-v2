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

/** The largest magnitude an amount may have: 9 integer digits */
const MAX_MINOR = 10 ** MAX_INTEGER_DIGITS * 100 - 1;

type Token = number | "+" | "-" | "*" | "/" | "(" | ")";

const OPERATOR_ALIASES: Record<string, Token> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "*": "*",
  "×": "*",
  "/": "/",
  "÷": "/",
  "(": "(",
  ")": ")",
};

const NUMBER_PATTERN = /^(\d{1,9})(?:[.,](\d{0,2}))?/;

/** Numbers become minor units; null for anything else (letters, 3 decimals) */
const tokenize = (compact: string): Token[] | null => {
  const tokens: Token[] = [];
  let rest = compact;

  while (rest) {
    const operator = OPERATOR_ALIASES[rest[0] ?? ""];

    if (operator) {
      tokens.push(operator);
      rest = rest.slice(1);
      continue;
    }

    const match = NUMBER_PATTERN.exec(rest);

    if (!match || /^[\d.,]/.test(rest.slice(match[0].length))) {
      return null;
    }

    const [whole, integral = "0", fraction = ""] = match;
    tokens.push(
      Number.parseInt(integral, 10) * 100 +
        Number.parseInt(fraction.padEnd(2, "0"), 10),
    );
    rest = rest.slice(whole.length);
  }

  return tokens;
};

/**
 * Recursive descent over minor units: `+ -` below `* /`, parentheses, and a
 * unary minus only where the caller allows one. Products and quotients keep
 * their fraction until the end, so `10/3*3` is 10 again.
 */
const evaluateTokens = (
  tokens: Token[],
  allowUnaryMinus: boolean,
): number | null => {
  let index = 0;

  const factor = (): number | null => {
    const token = tokens[index];

    // a minus sign in front of the first number: "-5+3" is -2
    if (token === "-" && index === 0 && allowUnaryMinus) {
      index += 1;
      const value = factor();

      return value === null ? null : -value;
    }

    if (typeof token === "number") {
      index += 1;
      return token;
    }

    if (token === "(") {
      index += 1;
      const value = sum();

      if (value === null || tokens[index] !== ")") {
        return null;
      }

      index += 1;
      return value;
    }

    return null;
  };

  const product = (): number | null => {
    let value = factor();

    while (value !== null && (tokens[index] === "*" || tokens[index] === "/")) {
      const operator = tokens[index];
      index += 1;
      const right = factor();

      if (right === null || (operator === "/" && right === 0)) {
        return null;
      }

      value = operator === "*" ? (value * right) / 100 : (value * 100) / right;
    }

    return value;
  };

  const sum = (): number | null => {
    let value = product();

    while (value !== null && (tokens[index] === "+" || tokens[index] === "-")) {
      const operator = tokens[index];
      index += 1;
      const right = product();

      if (right === null) {
        return null;
      }

      value = operator === "+" ? value + right : value - right;
    }

    return value;
  };

  const value = sum();

  return value === null || index !== tokens.length ? null : value;
};

/** Rounds half away from zero, ignoring float noise below a millionth */
const roundMinor = (value: number): number => {
  const magnitude = Math.round(Math.abs(value) * 1e6) / 1e6;
  const rounded = Math.round(magnitude);

  return value < 0 && rounded !== 0 ? -rounded : rounded;
};

/**
 * An amount field's text, which may be arithmetic (`120+35,5`, `3*49.90`,
 * `(100-20)/2`), as minor units. Numbers take "," or "." and at most 2
 * decimals; the operators are `+ - * /` (also `− × ÷`) and parentheses.
 *
 * Like ZenMoney, text that starts with an operator continues `base`, the
 * value the field had before: `+50` on 100 is 150. Without `allowSign` a
 * leading `-` does that too, and a negative result is invalid; with it, a
 * leading `-` is a minus sign. Null for anything that isn't an amount, a
 * division by zero, or more than 9 integer digits.
 */
export const evaluateAmount = (
  value: string,
  {
    allowSign = false,
    base,
  }: { allowSign?: boolean; base?: number | null } = {},
): number | null => {
  const compact = value.replace(/[\s ]/g, "");
  let tokens = tokenize(compact);

  if (!tokens || tokens.length === 0) {
    return null;
  }

  const first = tokens[0];
  const continues =
    first === "+" ||
    first === "*" ||
    first === "/" ||
    (first === "-" && !allowSign);

  if (continues) {
    if (base === undefined || base === null) {
      // "+5" alone is just 5 where a sign is allowed, as in parseAmountInput
      if (!(allowSign && first === "+")) {
        return null;
      }

      tokens = tokens.slice(1);
    } else {
      tokens = [base, ...tokens];
    }
  }

  const result = evaluateTokens(tokens, allowSign);

  if (result === null || !Number.isFinite(result)) {
    return null;
  }

  const minor = roundMinor(result);

  if (Math.abs(minor) > MAX_MINOR || (!allowSign && minor < 0)) {
    return null;
  }

  return minor;
};

/**
 * Whether the text is arithmetic rather than a plain amount: an operator
 * after the first character, parentheses, or a leading operator that
 * continues the previous value (a leading `-` is a sign with `allowSign`).
 */
export const isAmountExpression = (
  value: string,
  { allowSign = false }: { allowSign?: boolean } = {},
): boolean => {
  const compact = value.replace(/[\s ]/g, "");
  const operators = /[+\-−*×/÷()]/;

  if (compact === "") {
    return false;
  }

  if (operators.test(compact.slice(1))) {
    return true;
  }

  const first = compact[0] ?? "";

  return operators.test(first) && !(allowSign && /[+\-−]/.test(first));
};
