import { Schema } from "effect";

import {
  inviteIdSchema,
  makeOtpQrSchema,
  registerSchema,
} from "~/lib/validators/auth";
import { createTRPCRouter, publicProcedure, validate } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import { makeOtpQr, register, validateInvite } from "~/server/services/invites";

export const invitesRouter = createTRPCRouter({
  validate: publicProcedure
    .input(validate(Schema.Struct({ id: inviteIdSchema })))
    .query(async ({ input, signal }) => {
      const invite = await runForTrpc(validateInvite(input.id), signal);

      return { isAdmin: invite.isAdmin };
    }),

  makeOtpQR: publicProcedure
    .input(validate(makeOtpQrSchema))
    .mutation(({ input, signal }) => runForTrpc(makeOtpQr(input), signal)),

  register: publicProcedure
    .input(validate(registerSchema))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(register({ ...input, locale: ctx.locale }), signal),
    ),
});
