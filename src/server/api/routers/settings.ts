import { z } from "zod";

import {
  otpSchema,
  passwordSchema,
  secondFactorSchema,
} from "~/lib/validators/auth";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
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
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(
        changePassword(
          { id: ctx.user.id, sessionId: ctx.sessionId ?? null },
          input,
        ),
        signal,
      ),
    ),

  startReenrol: protectedProcedure
    .input(z.object({ password: current, code: secondFactorSchema }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(startReenrol(ctx.user.id, input), signal),
    ),

  confirmReenrol: protectedProcedure
    .input(z.object({ code: otpSchema }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(
        confirmReenrol(
          { id: ctx.user.id, sessionId: ctx.sessionId ?? null },
          input.code,
        ),
        signal,
      ),
    ),

  backupCodes: protectedProcedure
    .input(z.object({ password: current, code: otpSchema }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(newBackupCodes(ctx.user.id, input), signal),
    ),
});
