import { Schema } from "effect";

import { LOCALES } from "~/i18n/config";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import { profileOf, setLocale } from "~/server/services/profile";

export const meRouter = createTRPCRouter({
  get: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(profileOf(ctx.user), signal),
  ),

  setLocale: protectedProcedure
    .input(validate(Schema.Struct({ locale: Schema.Literals(LOCALES) })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(setLocale(ctx.user.id, input.locale), signal),
    ),
});
