import { z } from "zod";

import { calendarDateSchema } from "~/lib/validators/common";
import { transactionFilterSchema } from "~/lib/validators/transactions";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  compareCategoryTotals,
  reportRows,
} from "~/server/services/transaction-queries";

const periodSchema = z
  .object({ startDate: calendarDateSchema, endDate: calendarDateSchema })
  .refine((value) => value.startDate <= value.endDate, {
    error: "start_date_lte_end_date",
    path: ["startDate"],
  });

export const reportsRouter = createTRPCRouter({
  /** The date range is required for reports */
  data: protectedProcedure
    .input(
      z.object({
        filter: transactionFilterSchema.and(
          z.object({
            startDate: calendarDateSchema,
            endDate: calendarDateSchema,
          }),
        ),
      }),
    )
    .query(({ ctx, input, signal }) =>
      runForTrpc(reportRows(ctx.user.id, input.filter), signal),
    ),

  /** Per-category totals of two periods under the same filter */
  compare: protectedProcedure
    .input(
      z.object({
        filter: transactionFilterSchema,
        periods: z.tuple([periodSchema, periodSchema]),
      }),
    )
    .query(({ ctx, input, signal }) =>
      runForTrpc(
        compareCategoryTotals(ctx.user.id, input.filter, input.periods),
        signal,
      ),
    ),
});
