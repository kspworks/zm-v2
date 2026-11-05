import { Schema } from "effect";

import {
  calendarDateSchema,
  idSchema,
  magnitudeSchema,
  maxLength,
  message,
  minorUnitsSchema,
  nullable,
  nullish,
  withDefault,
} from "~/lib/validators/common";
import {
  listInputSchema,
  transactionFilterSchema,
  transactionInputSchema,
  transactionUpdateSchema,
} from "~/lib/validators/transactions";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
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
    .input(validate(listInputSchema))
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
    .input(validate(listInputSchema))
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
    .input(validate(Schema.Struct({ filter: transactionFilterSchema })))
    .query(({ ctx, input, signal }) =>
      runForTrpc(listOverdue(ctx.user.id, input.filter), signal),
    ),

  /** Totals over the whole filtered set: submitted rows, or planned ones */
  totals: protectedProcedure
    .input(
      validate(
        Schema.Struct({
          filter: transactionFilterSchema,
          planned: Schema.Boolean.pipe(withDefault(false)),
        }),
      ),
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
    .input(validate(transactionInputSchema))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(createTransaction(ctx.user.id, input), signal),
    ),

  update: protectedProcedure
    .input(validate(transactionUpdateSchema))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(updateTransaction(ctx.user.id, input), signal),
    ),

  delete: protectedProcedure
    .input(validate(Schema.Struct({ id: idSchema })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteTransaction(ctx.user.id, input.id), signal),
    ),

  /** Several transactions in one call and one DB transaction */
  bulkCreate: protectedProcedure
    .input(
      validate(
        Schema.Struct({
          items: Schema.Array(transactionInputSchema).check(
            Schema.isBetweenLength(1, 100, message("invalid_value")),
          ),
        }),
      ),
    )
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(bulkCreate(ctx.user.id, input.items), signal),
    ),

  /** Records the difference between the actual and the derived balance */
  adjustBalance: protectedProcedure
    .input(
      validate(
        Schema.Struct({
          accountId: idSchema,
          actualBalance: minorUnitsSchema,
          date: nullish(calendarDateSchema),
          splits: nullish(
            Schema.Array(
              Schema.Struct({
                kind: Schema.Literals(["expense", "income"]),
                amount: magnitudeSchema,
                categoryId: nullable(idSchema),
              }),
            ).check(maxLength(100)),
          ),
        }),
      ),
    )
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(adjustBalance(ctx.user.id, input), signal),
    ),
});
