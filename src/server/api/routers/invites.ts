import { z } from "zod";

import {
  inviteIdSchema,
  makeOtpQrSchema,
  registerSchema,
} from "~/lib/validators/auth";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import { makeOtpQr, register, validateInvite } from "~/server/services/invites";

export const invitesRouter = createTRPCRouter({
  validate: publicProcedure
    .input(z.object({ id: inviteIdSchema }))
    .query(async ({ input, signal }) => {
      const invite = await runForTrpc(validateInvite(input.id), signal);

      return { isAdmin: invite.isAdmin };
    }),

  makeOtpQR: publicProcedure
    .input(makeOtpQrSchema)
    .mutation(({ input, signal }) => runForTrpc(makeOtpQr(input), signal)),

  register: publicProcedure
    .input(registerSchema)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(register({ ...input, locale: ctx.locale }), signal),
    ),
});
