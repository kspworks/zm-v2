import { z } from "zod";

import { idSchema } from "~/lib/validators/common";
import {
  listInputSchema,
  transactionFilterSchema,
  transactionInputSchema,
  transactionUpdateSchema,
} from "~/lib/validators/transactions";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { paginationLimit } from "~/server/config";
import {
  filteredTotals,
  listOverdue,
  listTransactions,
} from "~/server/services/transaction-queries";
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from "~/server/services/transactions";

export const transactionsRouter = createTRPCRouter({
  /** Submitted rows, newest first */
  list: protectedProcedure.input(listInputSchema).query(({ ctx, input }) =>
    listTransactions(ctx.db, ctx.user.id, {
      filter: input.filter,
      cursor: input.cursor,
      planned: "submitted",
      limit: paginationLimit(),
    }),
  ),

  /** Planned rows, oldest first, each with its schedule */
  planned: protectedProcedure.input(listInputSchema).query(({ ctx, input }) =>
    listTransactions(ctx.db, ctx.user.id, {
      filter: input.filter,
      cursor: input.cursor,
      planned: "planned",
      limit: paginationLimit(),
    }),
  ),

  overdue: protectedProcedure
    .input(z.object({ filter: transactionFilterSchema }))
    .query(({ ctx, input }) => listOverdue(ctx.db, ctx.user.id, input.filter)),

  totals: protectedProcedure
    .input(z.object({ filter: transactionFilterSchema }))
    .query(({ ctx, input }) =>
      filteredTotals(ctx.db, ctx.user.id, input.filter),
    ),

  create: protectedProcedure
    .input(transactionInputSchema)
    .mutation(({ ctx, input }) =>
      createTransaction(ctx.db, ctx.user.id, input),
    ),

  update: protectedProcedure
    .input(transactionUpdateSchema)
    .mutation(({ ctx, input }) =>
      updateTransaction(ctx.db, ctx.user.id, input),
    ),

  delete: protectedProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) =>
      deleteTransaction(ctx.db, ctx.user.id, input.id),
    ),
});
