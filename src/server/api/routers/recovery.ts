import { z } from "zod";

import { otpSchema, passwordSchema } from "~/lib/validators/auth";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  completeRecovery,
  startRecoveryEnrolment,
  validateRecoveryLink,
} from "~/server/services/recovery";

const token = z.string().trim().min(1).max(128);

export const recoveryRouter = createTRPCRouter({
  validate: publicProcedure
    .input(z.object({ token }))
    .query(({ ctx, input }) => validateRecoveryLink(ctx.db, input.token)),

  startEnrolment: publicProcedure
    .input(z.object({ token }))
    .mutation(({ ctx, input }) => startRecoveryEnrolment(ctx.db, input.token)),

  complete: publicProcedure
    .input(
      z.object({
        token,
        newPassword: passwordSchema.nullish(),
        currentPassword: z.string().max(128).nullish(),
        code: otpSchema.nullish(),
      }),
    )
    .mutation(({ ctx, input }) => completeRecovery(ctx.db, input)),
});
