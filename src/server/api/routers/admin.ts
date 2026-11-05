import { z } from "zod";

import { idSchema } from "~/lib/validators/common";
import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";
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

const userInput = z.object({ userId: idSchema });

export const adminRouter = createTRPCRouter({
  invites: adminProcedure.query(({ signal }) =>
    runForTrpc(listInvites(), signal),
  ),

  createInvite: adminProcedure
    .input(z.object({ comment: z.string().trim().min(1).max(255) }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(createInvite(ctx.user.id, input.comment), signal),
    ),

  deleteInvite: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(({ input, signal }) =>
      runForTrpc(deleteInvite(input.id), signal),
    ),

  users: adminProcedure.query(({ signal }) => runForTrpc(listUsers(), signal)),

  setRole: adminProcedure
    .input(userInput.extend({ role: z.enum(["admin", "user"]) }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(setRole(ctx.user.id, input), signal),
    ),

  setBanned: adminProcedure
    .input(userInput.extend({ banned: z.boolean() }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(setBanned(ctx.user.id, input), signal),
    ),

  deleteUser: adminProcedure
    .input(userInput)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteUser(ctx.user.id, input.userId), signal),
    ),

  restoreUser: adminProcedure
    .input(userInput)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(restoreUser(ctx.user.id, input.userId), signal),
    ),

  revokeSessions: adminProcedure
    .input(userInput)
    .mutation(({ input, signal }) =>
      runForTrpc(revokeSessions(input.userId), signal),
    ),

  recoveryLinks: adminProcedure
    .input(userInput)
    .query(({ input, signal }) =>
      runForTrpc(listRecoveryLinks(input.userId), signal),
    ),

  createRecoveryLink: adminProcedure
    .input(
      userInput.extend({ scope: z.enum(["password", "twoFactor", "both"]) }),
    )
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(
        createRecoveryLink(ctx.user.id, { ...input, origin: ctx.origin }),
        signal,
      ),
    ),

  revokeRecoveryLink: adminProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ input, signal }) =>
      runForTrpc(revokeRecoveryLink(input.id), signal),
    ),
});
