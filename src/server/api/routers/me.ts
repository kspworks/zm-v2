import { Schema } from "effect";

import { LOCALES } from "~/i18n/config";
import { idSchema } from "~/lib/validators/common";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  primaryCurrencyOf,
  profileOf,
  setLocale,
  setPrimaryCurrency,
} from "~/server/services/profile";

export const meRouter = createTRPCRouter({
  get: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(profileOf(ctx.user), signal),
  ),

  primaryCurrency: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(primaryCurrencyOf(ctx.user.id), signal),
  ),

  setPrimaryCurrency: protectedProcedure
    .input(validate(Schema.Struct({ currencyId: idSchema })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(setPrimaryCurrency(ctx.user.id, input.currencyId), signal),
    ),

  setLocale: protectedProcedure
    .input(validate(Schema.Struct({ locale: Schema.Literals(LOCALES) })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(setLocale(ctx.user.id, input.locale), signal),
    ),
});
