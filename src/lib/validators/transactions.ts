import { z } from "zod";

import { amountFilterRange, MAX_INTEGER_DIGITS } from "~/lib/money";
import {
  calendarDateSchema,
  commentSchema,
  idSchema,
} from "~/lib/validators/common";

const MAX_MINOR = 10 ** (MAX_INTEGER_DIGITS + 2) - 1;

/** A positive magnitude in minor units; the kind decides the stored sign */
export const magnitudeSchema = z.number().int().min(1).max(MAX_MINOR);

/**
 * A counterparty picked from the combobox (an id) or typed as a new name,
 * which is created-or-matched case-insensitively on save.
 */
export const counterpartyRefSchema = z
  .object({
    id: idSchema.nullish(),
    name: z.string().trim().max(255).nullish(),
  })
  .refine((ref) => !!ref.id || !!ref.name, { error: "is_nonempty" });

const shared = {
  date: calendarDateSchema,
  amount: magnitudeSchema,
  accountId: idSchema,
  comment: commentSchema,
};

export const expenseInputSchema = z.object({
  kind: z.literal("expense"),
  ...shared,
  categoryId: idSchema.nullish().transform((value) => value ?? null),
  counterparty: counterpartyRefSchema.nullish(),
});

export const incomeInputSchema = z.object({
  kind: z.literal("income"),
  ...shared,
  categoryId: idSchema.nullish().transform((value) => value ?? null),
  counterparty: counterpartyRefSchema.nullish(),
});

export const transferInputSchema = z.object({
  kind: z.literal("transfer"),
  ...shared,
  linkedAccountId: idSchema,
  linkedAmount: magnitudeSchema,
});

export const DEBT_DIRECTIONS = ["gave", "took"] as const;

export const debtInputSchema = z.object({
  kind: z.literal("debt"),
  ...shared,
  /** "gave": I lent, or repaid my debt. "took": I borrowed, or got repaid */
  direction: z.enum(DEBT_DIRECTIONS),
  counterparty: counterpartyRefSchema,
});

export const transactionInputSchema = z.discriminatedUnion("kind", [
  expenseInputSchema,
  incomeInputSchema,
  transferInputSchema,
  debtInputSchema,
]);

/** The parsed shape the services work with */
export type TransactionInput = z.infer<typeof transactionInputSchema>;

/** The shape callers send (optional fields may be omitted) */
export type TransactionInputData = z.input<typeof transactionInputSchema>;

export type TransactionKind = TransactionInput["kind"];

export const transactionUpdateSchema = z.object({
  id: idSchema,
  data: transactionInputSchema,
});

/** The special category filter value that means "no category" */
export const NO_CATEGORY = "null";

const idList = z.array(idSchema).max(200).default([]);

export const transactionFilterSchema = z
  .object({
    accounts: idList,
    categories: idList,
    counterparties: idList,
    startDate: calendarDateSchema.nullish(),
    endDate: calendarDateSchema.nullish(),
    amount: z
      .string()
      .trim()
      .nullish()
      .refine((value) => !value || amountFilterRange(value) !== null, {
        error: "is_minor_units",
      }),
    comment: z.string().trim().max(500).nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      ctx.addIssue({
        code: "custom",
        message: "start_date_lte_end_date",
        path: ["startDate"],
      });
      ctx.addIssue({
        code: "custom",
        message: "end_date_gte_start_date",
        path: ["endDate"],
      });
    }
  });

export type TransactionFilter = z.infer<typeof transactionFilterSchema>;

/**
 * Keyset cursor. createdAt is Postgres' own text form of the timestamptz, so
 * microseconds survive the round trip (a JS Date would truncate them and
 * skip or repeat rows).
 */
export const cursorSchema = z.object({
  date: calendarDateSchema,
  createdAt: z.string().min(1).max(64),
  id: idSchema,
});

export type ListCursor = z.infer<typeof cursorSchema>;

export const listInputSchema = z.object({
  filter: transactionFilterSchema.default({
    accounts: [],
    categories: [],
    counterparties: [],
  }),
  cursor: cursorSchema.nullish(),
});

export const isFilterActive = (filter: Partial<TransactionFilter>): boolean =>
  (filter.accounts?.length ?? 0) > 0 ||
  (filter.categories?.length ?? 0) > 0 ||
  (filter.counterparties?.length ?? 0) > 0 ||
  !!filter.startDate ||
  !!filter.endDate ||
  !!filter.amount ||
  !!filter.comment;
