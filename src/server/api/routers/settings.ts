import { Schema } from "effect";

import {
  otpSchema,
  passwordSchema,
  secondFactorSchema,
} from "~/lib/validators/auth";
import { maxLength, message } from "~/lib/validators/common";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  changePassword,
  confirmReenrol,
  newBackupCodes,
  startReenrol,
} from "~/server/services/credentials";

const current = Schema.String.check(
  Schema.isMinLength(1, message("is_nonempty")),
  maxLength(128),
);

export const settingsRouter = createTRPCRouter({
  changePassword: protectedProcedure
    .input(
      validate(
        Schema.Struct({
          currentPassword: current,
          newPassword: passwordSchema,
          code: otpSchema,
        }),
      ),
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
    .input(
      validate(Schema.Struct({ password: current, code: secondFactorSchema })),
    )
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(startReenrol(ctx.user.id, input), signal),
    ),

  confirmReenrol: protectedProcedure
    .input(validate(Schema.Struct({ code: otpSchema })))
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
    .input(validate(Schema.Struct({ password: current, code: otpSchema })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(newBackupCodes(ctx.user.id, input), signal),
    ),
});
