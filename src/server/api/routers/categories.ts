import { z } from "zod";

import {
  categoryInputSchema,
  categoryUpdateSchema,
} from "~/lib/validators/categories";
import { idSchema } from "~/lib/validators/common";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "~/server/services/categories";

export const categoriesRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    listCategories(ctx.db, ctx.user.id, ctx.user.locale),
  ),

  create: protectedProcedure
    .input(categoryInputSchema)
    .mutation(({ ctx, input }) => createCategory(ctx.db, ctx.user.id, input)),

  update: protectedProcedure
    .input(categoryUpdateSchema)
    .mutation(({ ctx, input }) => updateCategory(ctx.db, ctx.user.id, input)),

  delete: protectedProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) =>
      deleteCategory(ctx.db, ctx.user.id, input.id),
    ),
});
