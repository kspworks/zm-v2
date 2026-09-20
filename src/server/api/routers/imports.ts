import { z } from "zod";

import { MAX_UPLOAD_BYTES } from "~/lib/import-limits";
import { idSchema } from "~/lib/validators/common";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  listImports,
  undoImport,
  uploadImport,
} from "~/server/services/imports";

export const importsRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) => listImports(ctx.db, ctx.user.id)),

  upload: protectedProcedure
    .input(
      z.object({
        fileName: z.string().trim().min(1).max(255),
        // base64 of the gzipped file, at most MAX_UPLOAD_BYTES compressed
        content: z.base64().max(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4),
      }),
    )
    .mutation(({ ctx, input }) => uploadImport(ctx.db, ctx.user.id, input)),

  undo: protectedProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) => undoImport(ctx.db, ctx.user.id, input.id)),
});
