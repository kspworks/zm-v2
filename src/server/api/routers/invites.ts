import { z } from "zod";

import {
  inviteIdSchema,
  makeOtpQrSchema,
  registerSchema,
} from "~/lib/validators/auth";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { makeOtpQr, register, validateInvite } from "~/server/services/invites";

export const invitesRouter = createTRPCRouter({
  validate: publicProcedure
    .input(z.object({ id: inviteIdSchema }))
    .query(async ({ ctx, input }) => {
      const invite = await validateInvite(input.id, ctx.db);

      return { isAdmin: invite.isAdmin };
    }),

  makeOtpQR: publicProcedure
    .input(makeOtpQrSchema)
    .mutation(({ ctx, input }) => makeOtpQr(input, ctx.db)),

  register: publicProcedure
    .input(registerSchema)
    .mutation(({ ctx, input }) =>
      register({ ...input, locale: ctx.locale }, ctx.db),
    ),
});
