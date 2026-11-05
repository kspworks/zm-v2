import { z } from "zod";

import { otpSchema, passwordSchema } from "~/lib/validators/auth";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  completeRecovery,
  startRecoveryEnrolment,
  validateRecoveryLink,
} from "~/server/services/recovery";

const token = z.string().trim().min(1).max(128);

export const recoveryRouter = createTRPCRouter({
  validate: publicProcedure
    .input(z.object({ token }))
    .query(({ input, signal }) =>
      runForTrpc(validateRecoveryLink(input.token), signal),
    ),

  startEnrolment: publicProcedure
    .input(z.object({ token }))
    .mutation(({ input, signal }) =>
      runForTrpc(startRecoveryEnrolment(input.token), signal),
    ),

  complete: publicProcedure
    .input(
      z.object({
        token,
        newPassword: passwordSchema.nullish(),
        currentPassword: z.string().max(128).nullish(),
        code: otpSchema.nullish(),
      }),
    )
    .mutation(({ input, signal }) =>
      runForTrpc(completeRecovery(input), signal),
    ),
});
