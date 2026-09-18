import { z } from "zod";

import { idSchema } from "~/lib/validators/common";
import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";
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
  invites: adminProcedure.query(({ ctx }) => listInvites(ctx.db)),

  createInvite: adminProcedure
    .input(z.object({ comment: z.string().trim().min(1).max(255) }))
    .mutation(({ ctx, input }) =>
      createInvite(ctx.db, ctx.user.id, input.comment),
    ),

  deleteInvite: adminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(({ ctx, input }) => deleteInvite(ctx.db, input.id)),

  users: adminProcedure.query(({ ctx }) => listUsers(ctx.db)),

  setRole: adminProcedure
    .input(userInput.extend({ role: z.enum(["admin", "user"]) }))
    .mutation(({ ctx, input }) => setRole(ctx.db, ctx.user.id, input)),

  setBanned: adminProcedure
    .input(userInput.extend({ banned: z.boolean() }))
    .mutation(({ ctx, input }) => setBanned(ctx.db, ctx.user.id, input)),

  deleteUser: adminProcedure
    .input(userInput)
    .mutation(({ ctx, input }) =>
      deleteUser(ctx.db, ctx.user.id, input.userId),
    ),

  restoreUser: adminProcedure
    .input(userInput)
    .mutation(({ ctx, input }) =>
      restoreUser(ctx.db, ctx.user.id, input.userId),
    ),

  revokeSessions: adminProcedure
    .input(userInput)
    .mutation(({ ctx, input }) => revokeSessions(ctx.db, input.userId)),

  recoveryLinks: adminProcedure
    .input(userInput)
    .query(({ ctx, input }) => listRecoveryLinks(ctx.db, input.userId)),

  createRecoveryLink: adminProcedure
    .input(
      userInput.extend({ scope: z.enum(["password", "twoFactor", "both"]) }),
    )
    .mutation(({ ctx, input }) =>
      createRecoveryLink(ctx.db, ctx.user.id, { ...input, origin: ctx.origin }),
    ),

  revokeRecoveryLink: adminProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) => revokeRecoveryLink(ctx.db, input.id)),
});
