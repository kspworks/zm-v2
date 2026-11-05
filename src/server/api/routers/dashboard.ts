import { Schema } from "effect";

import { RANGE_MAX, RANGE_MIN } from "~/lib/dashboard";
import {
  idSchema,
  maxLength,
  message,
  withDefault,
} from "~/lib/validators/common";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  balanceSeries,
  forecast,
  nearestPlanned,
} from "~/server/services/dashboard";

const days = Schema.Int.check(
  Schema.isBetween(
    { minimum: RANGE_MIN, maximum: RANGE_MAX },
    message("invalid_value"),
  ),
);

/** The selected accounts (all when omitted) and whether debt pairs count */
const scope = {
  currencyId: idSchema,
  accountIds: Schema.optional(Schema.Array(idSchema).check(maxLength(200))),
  includeDebts: Schema.Boolean.pipe(withDefault(true)),
};

export const dashboardRouter = createTRPCRouter({
  balance: protectedProcedure
    .input(validate(Schema.Struct({ ...scope, back: days, ahead: days })))
    .query(({ ctx, input, signal }) =>
      runForTrpc(balanceSeries(ctx.user.id, input), signal),
    ),

  forecast: protectedProcedure
    .input(validate(Schema.Struct(scope)))
    .query(({ ctx, input, signal }) =>
      runForTrpc(forecast(ctx.user.id, input), signal),
    ),

  nearest: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(nearestPlanned(ctx.user.id), signal),
  ),
});
