import { z } from "zod";

import {
  otpSchema,
  passwordSchema,
  secondFactorSchema,
} from "~/lib/validators/auth";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  changePassword,
  confirmReenrol,
  newBackupCodes,
  startReenrol,
} from "~/server/services/credentials";

const current = z.string().min(1).max(128);

export const settingsRouter = createTRPCRouter({
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: current,
        newPassword: passwordSchema,
        code: otpSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      changePassword(
        ctx.db,
        { id: ctx.user.id, sessionId: ctx.sessionId ?? null },
        input,
      ),
    ),

  startReenrol: protectedProcedure
    .input(z.object({ password: current, code: secondFactorSchema }))
    .mutation(({ ctx, input }) => startReenrol(ctx.db, ctx.user.id, input)),

  confirmReenrol: protectedProcedure
    .input(z.object({ code: otpSchema }))
    .mutation(({ ctx, input }) =>
      confirmReenrol(
        ctx.db,
        { id: ctx.user.id, sessionId: ctx.sessionId ?? null },
        input.code,
      ),
    ),

  backupCodes: protectedProcedure
    .input(z.object({ password: current, code: otpSchema }))
    .mutation(({ ctx, input }) => newBackupCodes(ctx.db, ctx.user.id, input)),
});
