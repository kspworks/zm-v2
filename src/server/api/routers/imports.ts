import { Schema } from "effect";

import { MAX_UPLOAD_BYTES } from "~/lib/import-limits";
import {
  idSchema,
  maxLength,
  message,
  trimmedString,
} from "~/lib/validators/common";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  listImports,
  undoImport,
  uploadImport,
} from "~/server/services/imports";

export const importsRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(listImports(ctx.user.id), signal),
  ),

  upload: protectedProcedure
    .input(
      validate(
        Schema.Struct({
          fileName: trimmedString(255),
          // base64 of the gzipped file, at most MAX_UPLOAD_BYTES compressed
          content: Schema.String.check(
            Schema.isBase64(message("import_invalid")),
            maxLength(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4),
          ),
        }),
      ),
    )
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(uploadImport(ctx.user.id, input), signal),
    ),

  undo: protectedProcedure
    .input(validate(Schema.Struct({ id: idSchema })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(undoImport(ctx.user.id, input.id), signal),
    ),
});
