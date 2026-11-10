import { Schema } from "effect";

import { amountFilterRange } from "~/lib/money";
import {
  calendarDateSchema,
  commentSchema,
  idSchema,
  magnitudeSchema,
  maxLength,
  message,
  nullable,
  nullish,
  withDefault,
} from "~/lib/validators/common";

/**
 * A counterparty picked from the combobox (an id) or typed as a new name,
 * which is created-or-matched case-insensitively on save.
 */
export const counterpartyRefSchema = Schema.Struct({
  id: nullish(idSchema),
  name: nullish(Schema.Trim.check(maxLength(255))),
}).check(
  Schema.makeFilter(
    (ref: { id?: string | null; name?: string | null }) =>
      !!ref.id || !!ref.name,
    message("is_nonempty"),
  ),
);

const shared = {
  date: calendarDateSchema,
  amount: magnitudeSchema,
  accountId: idSchema,
  comment: commentSchema,
};

export const expenseInputSchema = Schema.Struct({
  kind: Schema.Literal("expense"),
  ...shared,
  categoryId: nullable(idSchema),
  counterparty: nullish(counterpartyRefSchema),
});

export const incomeInputSchema = Schema.Struct({
  kind: Schema.Literal("income"),
  ...shared,
  categoryId: nullable(idSchema),
  counterparty: nullish(counterpartyRefSchema),
});

export const transferInputSchema = Schema.Struct({
  kind: Schema.Literal("transfer"),
  ...shared,
  linkedAccountId: idSchema,
  linkedAmount: magnitudeSchema,
});

export const DEBT_DIRECTIONS = ["gave", "took"] as const;

export const debtInputSchema = Schema.Struct({
  kind: Schema.Literal("debt"),
  ...shared,
  /** "gave": I lent, or repaid my debt. "took": I borrowed, or got repaid */
  direction: Schema.Literals(DEBT_DIRECTIONS),
  counterparty: counterpartyRefSchema,
});

export const transactionInputSchema = Schema.Union([
  expenseInputSchema,
  incomeInputSchema,
  transferInputSchema,
  debtInputSchema,
]);

/** The parsed shape the services work with */
export type TransactionInput = typeof transactionInputSchema.Type;

/** The shape callers send (optional fields may be omitted) */
export type TransactionInputData = typeof transactionInputSchema.Encoded;

export type TransactionKind = TransactionInput["kind"];

export const transactionUpdateSchema = Schema.Struct({
  id: idSchema,
  data: transactionInputSchema,
});

/** The special category filter value that means "no category" */
export const NO_CATEGORY = "null";

const idList = Schema.Array(idSchema)
  .check(maxLength(200))
  .pipe(withDefault([]));

export const TRANSACTION_KINDS = [
  "expense",
  "income",
  "transfer",
  "debt",
] as const satisfies readonly TransactionKind[];

const transactionFilterFields = {
  accounts: idList,
  categories: idList,
  counterparties: idList,
  /** Empty means every kind */
  kinds: Schema.Array(Schema.Literals(TRANSACTION_KINDS))
    .check(maxLength(TRANSACTION_KINDS.length))
    .pipe(withDefault([])),
  startDate: nullish(calendarDateSchema),
  endDate: nullish(calendarDateSchema),
  amount: nullish(
    Schema.Trim.check(
      Schema.makeFilter(
        (value: string) => !value || amountFilterRange(value) !== null,
        message("is_minor_units"),
      ),
    ),
  ),
  comment: nullish(Schema.Trim.check(maxLength(500))),
};

/** The start date must not be after the end date */
export const dateRangeCheck = Schema.makeFilter(
  (value: { startDate?: string | null; endDate?: string | null }) =>
    value.startDate && value.endDate && value.startDate > value.endDate
      ? [
          { path: ["startDate"], issue: "start_date_lte_end_date" },
          { path: ["endDate"], issue: "end_date_gte_start_date" },
        ]
      : undefined,
);

export const transactionFilterSchema = Schema.Struct(
  transactionFilterFields,
).check(dateRangeCheck);

/** A filter whose date range is required (reports) */
export const rangedFilterSchema = Schema.Struct({
  ...transactionFilterFields,
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
}).check(dateRangeCheck);

export type TransactionFilter = typeof transactionFilterSchema.Type;

/**
 * Keyset cursor. createdAt is Postgres' own text form of the timestamptz, so
 * microseconds survive the round trip (a JS Date would truncate them and
 * skip or repeat rows).
 */
export const cursorSchema = Schema.Struct({
  date: calendarDateSchema,
  createdAt: Schema.String.check(
    Schema.isMinLength(1, message("is_nonempty")),
    maxLength(64),
  ),
  id: idSchema,
});

export type ListCursor = typeof cursorSchema.Type;

export const listInputSchema = Schema.Struct({
  filter: transactionFilterSchema.pipe(
    withDefault({ accounts: [], categories: [], counterparties: [] }),
  ),
  cursor: nullish(cursorSchema),
  /**
   * Planned list only: just the next occurrence of each series, so a monthly
   * payment is one row instead of twelve
   */
  nextOnly: nullish(Schema.Boolean),
});

export const isFilterActive = (filter: Partial<TransactionFilter>): boolean =>
  (filter.accounts?.length ?? 0) > 0 ||
  (filter.categories?.length ?? 0) > 0 ||
  (filter.counterparties?.length ?? 0) > 0 ||
  (filter.kinds?.length ?? 0) > 0 ||
  !!filter.startDate ||
  !!filter.endDate ||
  !!filter.amount ||
  !!filter.comment;
