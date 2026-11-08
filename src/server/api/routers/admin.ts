import { Schema } from "effect";

import { idSchema, trimmedString } from "~/lib/validators/common";
import { adminProcedure, createTRPCRouter, validate } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  createInvite,
  deleteInvite,
  deleteUser,
  listInvites,
  listUsers,
  restoreUser,
  revokeSessions,
  setBanned,
  setRole,
} from "~/server/services/admin";
import {
  createRecoveryLink,
  listRecoveryLinks,
  revokeRecoveryLink,
} from "~/server/services/recovery";

const userFields = { userId: idSchema };
const userInput = Schema.Struct(userFields);

export const adminRouter = createTRPCRouter({
  invites: adminProcedure.query(({ signal }) =>
    runForTrpc(listInvites(), signal),
  ),

  createInvite: adminProcedure
    .input(validate(Schema.Struct({ comment: trimmedString(255) })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(createInvite(ctx.user.id, input.comment), signal),
    ),

  deleteInvite: adminProcedure
    .input(validate(Schema.Struct({ id: trimmedString(64) })))
    .mutation(({ input, signal }) =>
      runForTrpc(deleteInvite(input.id), signal),
    ),

  users: adminProcedure.query(({ signal }) => runForTrpc(listUsers(), signal)),

  setRole: adminProcedure
    .input(
      validate(
        Schema.Struct({
          ...userFields,
          role: Schema.Literals(["admin", "user"]),
        }),
      ),
    )
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(setRole(ctx.user.id, input), signal),
    ),

  setBanned: adminProcedure
    .input(validate(Schema.Struct({ ...userFields, banned: Schema.Boolean })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(setBanned(ctx.user.id, input), signal),
    ),

  deleteUser: adminProcedure
    .input(validate(userInput))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteUser(ctx.user.id, input.userId), signal),
    ),

  restoreUser: adminProcedure
    .input(validate(userInput))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(restoreUser(ctx.user.id, input.userId), signal),
    ),

  revokeSessions: adminProcedure
    .input(validate(userInput))
    .mutation(({ input, signal }) =>
      runForTrpc(revokeSessions(input.userId), signal),
    ),

  recoveryLinks: adminProcedure
    .input(validate(userInput))
    .query(({ input, signal }) =>
      runForTrpc(listRecoveryLinks(input.userId), signal),
    ),

  createRecoveryLink: adminProcedure
    .input(
      validate(
        Schema.Struct({
          ...userFields,
          scope: Schema.Literals(["password", "twoFactor", "both"]),
        }),
      ),
    )
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(createRecoveryLink(ctx.user.id, input), signal),
    ),

  revokeRecoveryLink: adminProcedure
    .input(validate(Schema.Struct({ id: idSchema })))
    .mutation(({ input, signal }) =>
      runForTrpc(revokeRecoveryLink(input.id), signal),
    ),
});
