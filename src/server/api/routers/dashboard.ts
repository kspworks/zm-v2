import { z } from "zod";

import { RANGE_MAX, RANGE_MIN } from "~/lib/dashboard";
import { idSchema } from "~/lib/validators/common";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  balanceSeries,
  forecast,
  nearestPlanned,
} from "~/server/services/dashboard";

const days = z.number().int().min(RANGE_MIN).max(RANGE_MAX);

/** The selected accounts (all when omitted) and whether debt pairs count */
const scope = {
  currencyId: idSchema,
  accountIds: z.array(idSchema).max(200).optional(),
  includeDebts: z.boolean().default(true),
};

export const dashboardRouter = createTRPCRouter({
  balance: protectedProcedure
    .input(z.object({ ...scope, back: days, ahead: days }))
    .query(({ ctx, input, signal }) =>
      runForTrpc(balanceSeries(ctx.user.id, input), signal),
    ),

  forecast: protectedProcedure
    .input(z.object(scope))
    .query(({ ctx, input, signal }) =>
      runForTrpc(forecast(ctx.user.id, input), signal),
    ),

  nearest: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(nearestPlanned(ctx.user.id), signal),
  ),
});
