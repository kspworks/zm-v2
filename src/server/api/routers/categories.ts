import { z } from "zod";

import {
  categoryInputSchema,
  categoryUpdateSchema,
} from "~/lib/validators/categories";
import { idSchema } from "~/lib/validators/common";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "~/server/services/categories";

export const categoriesRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(listCategories(ctx.user.id, ctx.user.locale), signal),
  ),

  create: protectedProcedure
    .input(categoryInputSchema)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(createCategory(ctx.user.id, input), signal),
    ),

  update: protectedProcedure
    .input(categoryUpdateSchema)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(updateCategory(ctx.user.id, input), signal),
    ),

  delete: protectedProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteCategory(ctx.user.id, input.id), signal),
    ),
});
