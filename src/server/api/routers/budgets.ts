import { Schema } from "effect";

import { budgetInputSchema } from "~/lib/validators/budgets";
import { idSchema } from "~/lib/validators/common";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  deleteBudget,
  listBudgets,
  saveBudget,
} from "~/server/services/budgets";

export const budgetsRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(listBudgets(ctx.user.id), signal),
  ),

  save: protectedProcedure
    .input(validate(budgetInputSchema))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(saveBudget(ctx.user.id, input), signal),
    ),

  delete: protectedProcedure
    .input(validate(Schema.Struct({ id: idSchema })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteBudget(ctx.user.id, input.id), signal),
    ),
});
