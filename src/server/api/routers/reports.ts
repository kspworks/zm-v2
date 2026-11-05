import { Schema } from "effect";

import { calendarDateSchema } from "~/lib/validators/common";
import {
  dateRangeCheck,
  rangedFilterSchema,
  transactionFilterSchema,
} from "~/lib/validators/transactions";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  compareCategoryTotals,
  reportRows,
} from "~/server/services/transaction-queries";

const periodSchema = Schema.Struct({
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
}).check(dateRangeCheck);

export const reportsRouter = createTRPCRouter({
  /** The date range is required for reports */
  data: protectedProcedure
    .input(
      validate(
        Schema.Struct({
          filter: rangedFilterSchema,
        }),
      ),
    )
    .query(({ ctx, input, signal }) =>
      runForTrpc(reportRows(ctx.user.id, input.filter), signal),
    ),

  /** Per-category totals of two periods under the same filter */
  compare: protectedProcedure
    .input(
      validate(
        Schema.Struct({
          filter: transactionFilterSchema,
          periods: Schema.Tuple([periodSchema, periodSchema]),
        }),
      ),
    )
    .query(({ ctx, input, signal }) =>
      runForTrpc(
        compareCategoryTotals(ctx.user.id, input.filter, input.periods),
        signal,
      ),
    ),
});
