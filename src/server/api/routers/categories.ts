import { Schema } from "effect";

import {
  categoryCreateSchema,
  categoryHiddenSchema,
  categoryReplaceSchema,
  categoryUpdateSchema,
} from "~/lib/validators/categories";
import { idSchema } from "~/lib/validators/common";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import { idempotent } from "~/server/lib/idempotency";
import {
  createCategory,
  deleteCategory,
  listCategories,
  replaceCategory,
  setCategoryHidden,
  updateCategory,
} from "~/server/services/categories";

export const categoriesRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(listCategories(ctx.user.id, ctx.user.locale), signal),
  ),

  create: protectedProcedure
    .input(validate(categoryCreateSchema))
    .mutation(({ ctx, input: { idempotencyKey, ...input }, signal }) =>
      runForTrpc(
        idempotent(
          {
            userId: ctx.user.id,
            procedure: "categories.create",
            key: idempotencyKey,
            request: input,
          },
          createCategory(ctx.user.id, input),
        ),
        signal,
      ),
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

  /** Deletes a category after moving its rows to another one */
  replace: protectedProcedure
    .input(validate(categoryReplaceSchema))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(replaceCategory(ctx.user.id, input), signal),
    ),

  /** The user's own "show in category lists" choice */
  setHidden: protectedProcedure
    .input(validate(categoryHiddenSchema))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(setCategoryHidden(ctx.user.id, input), signal),
    ),
});
