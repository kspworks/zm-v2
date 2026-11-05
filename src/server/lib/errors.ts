import { Predicate, Schema } from "effect";

import { ERROR_KEYS, type ErrorKey } from "~/lib/error-keys";

/**
 * Business-rule violations. Each carries a stable snake_case key that the
 * client translates as `errors.<key>`; the tag decides the transport code
 * (see `~/server/effect/to-trpc-error`). Raise them with `return yield* …`.
 */
const ErrorKeySchema = Schema.Literals(ERROR_KEYS);
const keyed = { key: ErrorKeySchema };

export class BadRequest extends Schema.TaggedError<BadRequest>()(
  "BadRequest",
  keyed,
) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  keyed,
) {}

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  keyed,
) {}

/** No session, or the session's user is gone or banned; carries no key */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
) {}

export class TooManyRequests extends Schema.TaggedError<TooManyRequests>()(
  "TooManyRequests",
  keyed,
) {}

/** A rejected CSV import, with every row-level problem for the client */
export class ImportRowsError extends Schema.TaggedError<ImportRowsError>()(
  "ImportRowsError",
  {
    rows: Schema.Array(
      Schema.Struct({
        line: Schema.Number,
        field: Schema.String,
        key: ErrorKeySchema,
      }),
    ),
  },
) {}

export type AppError =
  | BadRequest
  | Forbidden
  | NotFound
  | Unauthorized
  | TooManyRequests
  | ImportRowsError;

export const badRequest = (key: ErrorKey) => new BadRequest({ key });
export const forbidden = (key: ErrorKey = "forbidden") =>
  new Forbidden({ key });
export const notFound = () => new NotFound({ key: "not_found" });
export const unauthorized = () => new Unauthorized();
export const tooManyRequests = (key: ErrorKey) => new TooManyRequests({ key });

type PgError = { code: string; constraint_name?: string };

const isPgError = (value: unknown): value is PgError =>
  Predicate.hasProperty(value, "code") &&
  Predicate.isString(value.code) &&
  /^[0-9A-Z]{5}$/.test(value.code);

/** postgres-js surfaces the SQLSTATE and constraint name on the error */
export const isUniqueViolation = (error: unknown, constraint?: string) => {
  const cause = findPgError(error);

  return (
    cause?.code === "23505" &&
    (constraint === undefined || cause.constraint_name === constraint)
  );
};

const findPgError = (error: unknown): PgError | undefined => {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth++) {
    if (isPgError(current)) {
      return current;
    }

    current = Predicate.hasProperty(current, "cause")
      ? current.cause
      : undefined;
  }

  return undefined;
};
