import {
  shareAddSchema,
  shareRevokeSchema,
  shareTargetSchema,
} from "~/lib/validators/sharing";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { addShare, listShares, revokeShare } from "~/server/services/sharing";

export const sharingRouter = createTRPCRouter({
  list: protectedProcedure
    .input(shareTargetSchema)
    .query(({ ctx, input }) => listShares(ctx.db, ctx.user.id, input)),

  add: protectedProcedure
    .input(shareAddSchema)
    .mutation(({ ctx, input }) => addShare(ctx.db, ctx.user.id, input)),

  revoke: protectedProcedure
    .input(shareRevokeSchema)
    .mutation(({ ctx, input }) => revokeShare(ctx.db, ctx.user.id, input)),
});
