import { z } from "zod";

import { LOCALES } from "~/i18n/config";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import { profileOf, setLocale } from "~/server/services/profile";

export const meRouter = createTRPCRouter({
  get: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(profileOf(ctx.user), signal),
  ),

  setLocale: protectedProcedure
    .input(z.object({ locale: z.enum(LOCALES) }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(setLocale(ctx.user.id, input.locale), signal),
    ),
});
