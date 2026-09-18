import { z } from "zod";

import { calendarDateSchema } from "~/lib/validators/common";
import { transactionFilterSchema } from "~/lib/validators/transactions";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { reportRows } from "~/server/services/transaction-queries";

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
});
