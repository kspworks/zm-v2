import { Schema } from "effect";

import { otpSchema, passwordSchema } from "~/lib/validators/auth";
import { maxLength, nullish, trimmedString } from "~/lib/validators/common";
import { createTRPCRouter, publicProcedure, validate } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  completeRecovery,
  startRecoveryEnrolment,
  validateRecoveryLink,
} from "~/server/services/recovery";

const token = trimmedString(128);

export const recoveryRouter = createTRPCRouter({
  validate: publicProcedure
    .input(validate(Schema.Struct({ token })))
    .query(({ input, signal }) =>
      runForTrpc(validateRecoveryLink(input.token), signal),
    ),

  startEnrolment: publicProcedure
    .input(validate(Schema.Struct({ token })))
    .mutation(({ input, signal }) =>
      runForTrpc(startRecoveryEnrolment(input.token), signal),
    ),

  complete: publicProcedure
    .input(
      validate(
        Schema.Struct({
          token,
          newPassword: nullish(passwordSchema),
          currentPassword: nullish(Schema.String.check(maxLength(128))),
          code: nullish(otpSchema),
        }),
      ),
    )
    .mutation(({ input, signal }) =>
      runForTrpc(completeRecovery(input), signal),
    ),
});
