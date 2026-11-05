import {
  shareAddSchema,
  shareRevokeSchema,
  shareTargetSchema,
} from "~/lib/validators/sharing";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import { addShare, listShares, revokeShare } from "~/server/services/sharing";

export const sharingRouter = createTRPCRouter({
  list: protectedProcedure
    .input(shareTargetSchema)
    .query(({ ctx, input, signal }) =>
      runForTrpc(listShares(ctx.user.id, input), signal),
    ),

  add: protectedProcedure
    .input(shareAddSchema)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(addShare(ctx.user.id, input), signal),
    ),

  revoke: protectedProcedure
    .input(shareRevokeSchema)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(revokeShare(ctx.user.id, input), signal),
    ),
});
