import { z } from "zod";

import { calendarDateSchema } from "~/lib/validators/common";
import { transactionFilterSchema } from "~/lib/validators/transactions";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  categoryTotals,
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
    .query(({ ctx, input }) => reportRows(ctx.db, ctx.user.id, input.filter)),

  /**
   * Per-category totals of two periods under the same filter; each period's
   * dates replace the filter's. Periods may overlap, so each is its own query.
   */
  compare: protectedProcedure
    .input(
      z.object({
        filter: transactionFilterSchema,
        periods: z.tuple([periodSchema, periodSchema]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [a, b] = await Promise.all(
        input.periods.map((period) =>
          categoryTotals(ctx.db, ctx.user.id, { ...input.filter, ...period }),
        ),
      );

      return { a: a ?? [], b: b ?? [] };
    }),
});
