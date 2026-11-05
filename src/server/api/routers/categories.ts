import { Schema } from "effect";

import {
  categoryInputSchema,
  categoryUpdateSchema,
} from "~/lib/validators/categories";
import { idSchema } from "~/lib/validators/common";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
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
    .input(validate(categoryInputSchema))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(createCategory(ctx.user.id, input), signal),
    ),

  update: protectedProcedure
    .input(validate(categoryUpdateSchema))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(updateCategory(ctx.user.id, input), signal),
    ),

  delete: protectedProcedure
    .input(validate(Schema.Struct({ id: idSchema })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteCategory(ctx.user.id, input.id), signal),
    ),
});
