import { z } from "zod";

import {
  calendarDateSchema,
  idSchema,
  minorUnitsSchema,
} from "~/lib/validators/common";
import {
  listInputSchema,
  magnitudeSchema,
  transactionFilterSchema,
  transactionInputSchema,
  transactionUpdateSchema,
} from "~/lib/validators/transactions";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import { adjustBalance, bulkCreate } from "~/server/services/bulk";
import {
  filteredTotals,
  listOverdue,
  listTransactionsPage,
} from "~/server/services/transaction-queries";
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from "~/server/services/transactions";

export const transactionsRouter = createTRPCRouter({
  /** Submitted rows, newest first */
  list: protectedProcedure
    .input(listInputSchema)
    .query(({ ctx, input, signal }) =>
      runForTrpc(
        listTransactionsPage(ctx.user.id, {
          filter: input.filter,
          cursor: input.cursor,
          planned: "submitted",
        }),
        signal,
      ),
    ),

  /** Planned rows, oldest first, each with its schedule */
  planned: protectedProcedure
    .input(listInputSchema)
    .query(({ ctx, input, signal }) =>
      runForTrpc(
        listTransactionsPage(ctx.user.id, {
          filter: input.filter,
          cursor: input.cursor,
          planned: "planned",
        }),
        signal,
      ),
    ),

  overdue: protectedProcedure
    .input(z.object({ filter: transactionFilterSchema }))
    .query(({ ctx, input, signal }) =>
      runForTrpc(listOverdue(ctx.user.id, input.filter), signal),
    ),

  /** Totals over the whole filtered set: submitted rows, or planned ones */
  totals: protectedProcedure
    .input(
      z.object({
        filter: transactionFilterSchema,
        planned: z.boolean().default(false),
      }),
    )
    .query(({ ctx, input, signal }) =>
      runForTrpc(
        filteredTotals(
          ctx.user.id,
          input.filter,
          input.planned ? "planned" : "submitted",
        ),
        signal,
      ),
    ),

  create: protectedProcedure
    .input(transactionInputSchema)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(createTransaction(ctx.user.id, input), signal),
    ),

  update: protectedProcedure
    .input(transactionUpdateSchema)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(updateTransaction(ctx.user.id, input), signal),
    ),

  delete: protectedProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteTransaction(ctx.user.id, input.id), signal),
    ),

  /** Several transactions in one call and one DB transaction */
  bulkCreate: protectedProcedure
    .input(z.object({ items: z.array(transactionInputSchema).min(1).max(100) }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(bulkCreate(ctx.user.id, input.items), signal),
    ),

  /** Records the difference between the actual and the derived balance */
  adjustBalance: protectedProcedure
    .input(
      z.object({
        accountId: idSchema,
        actualBalance: minorUnitsSchema,
        date: calendarDateSchema.nullish(),
        splits: z
          .array(
            z.object({
              kind: z.enum(["expense", "income"]),
              amount: magnitudeSchema,
              categoryId: idSchema
                .nullish()
                .transform((value) => value ?? null),
            }),
          )
          .max(100)
          .nullish(),
      }),
    )
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(adjustBalance(ctx.user.id, input), signal),
    ),
});
