import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import { exportCsv, exportJson } from "~/server/services/exports";

export const exportsRouter = createTRPCRouter({
  csv: protectedProcedure.mutation(({ ctx, signal }) =>
    runForTrpc(exportCsv(ctx.user.id), signal),
  ),

  json: protectedProcedure.mutation(({ ctx, signal }) =>
    runForTrpc(exportJson(ctx.user.id, ctx.user.locale), signal),
  ),
});
