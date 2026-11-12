import { Effect, Schema, SchemaTransformation } from "effect";

import type { ErrorKey } from "~/lib/error-keys";
import {
  evaluateAmount,
  isAmountExpression,
  MAX_INTEGER_DIGITS,
} from "~/lib/money";

/*
 * Shared Effect Schema building blocks. Every check carries an app error key
 * as its message, so forms show it translated (`errors.<key>`) and nothing
 * depends on Schema's own wording.
 */

/** Annotations for a check that fails with `key` */
export const message = (key: ErrorKey) => ({ message: key });

/**
 * What is wrong with an amount field's text, if anything: arithmetic that
 * can't be calculated, or not an amount. A magnitude (no `allowSign`) must
 * also be above zero. Returns the key, so a Schema filter can return it.
 */
export const amountIssue = (
  value: string,
  { allowSign = false }: { allowSign?: boolean } = {},
): ErrorKey | undefined => {
  const minor = evaluateAmount(value, { allowSign });

  if (minor === null) {
    return isAmountExpression(value, { allowSign })
      ? "amount_expression_invalid"
      : "is_minor_units";
  }

  return !allowSign && minor <= 0 ? "is_minor_units" : undefined;
};

export const nonEmpty = Schema.isMinLength(1, message("is_nonempty"));

export const maxLength = (max: number) =>
  Schema.isMaxLength(max, message("too_long"));

/** A trimmed string of at most `max` characters, required unless `min` is 0 */
export const trimmedString = (max: number, min = 1) =>
  min > 0
    ? Schema.Trim.check(nonEmpty, maxLength(max))
    : Schema.Trim.check(maxLength(max));

/** Absent, undefined or null all decode to null */
export const nullable = <S extends Schema.Top>(schema: S) =>
  Schema.NullOr(schema).pipe(Schema.withDecodingDefault(Effect.succeed(null)));

/** Absent, undefined or null; kept as given */
export const nullish = <S extends Schema.Top>(schema: S) =>
  Schema.optional(Schema.NullOr(schema));

/** Absent or undefined decodes to `value` */
export const withDefault =
  <S extends Schema.Top>(value: S["Encoded"]) =>
  (schema: S) =>
    schema.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const idSchema = trimmedString(64);

const MAX_MINOR = 10 ** (MAX_INTEGER_DIGITS + 2) - 1;

/** A signed amount in minor units within the 9-integer-digit input range */
export const minorUnitsSchema = Schema.Int.check(
  Schema.isBetween(
    { minimum: -MAX_MINOR, maximum: MAX_MINOR },
    message("is_minor_units"),
  ),
);

/** A positive magnitude in minor units; the kind decides the stored sign */
export const magnitudeSchema = Schema.Int.check(
  Schema.isBetween(
    { minimum: 1, maximum: MAX_MINOR },
    message("is_minor_units"),
  ),
);

const isCalendarDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const [, y, m, d] = match.map(Number) as number[];
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));

  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() + 1 === m &&
    date.getUTCDate() === d
  );
};

/** A real calendar day as "yyyy-MM-dd" */
export const calendarDateSchema = Schema.String.check(
  Schema.makeFilter(isCalendarDate, message("invalid_date")),
);

export const trimmedName = trimmedString(255);

/** Trimmed, at most 500 chars; absent, null or empty becomes null */
export const commentSchema = nullable(
  Schema.Trim.check(maxLength(500)).pipe(
    Schema.decodeTo(
      Schema.NullOr(Schema.String),
      SchemaTransformation.transform({
        decode: (value: string) => (value ? value : null),
        encode: (value: string | null) => value ?? "",
      }),
    ),
  ),
);
