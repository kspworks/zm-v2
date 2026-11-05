import { Schema } from "effect";

import { idSchema, trimmedName } from "~/lib/validators/common";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  counterpartyBalances,
  deleteCounterparty,
  listCounterparties,
  mergeCounterparties,
  renameCounterparty,
} from "~/server/services/counterparties";

export const counterpartiesRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(listCounterparties(ctx.user.id), signal),
  ),

  balances: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(counterpartyBalances(ctx.user.id), signal),
  ),

  rename: protectedProcedure
    .input(validate(Schema.Struct({ id: idSchema, name: trimmedName })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(renameCounterparty(ctx.user.id, input), signal),
    ),

  merge: protectedProcedure
    .input(validate(Schema.Struct({ sourceId: idSchema, targetId: idSchema })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(mergeCounterparties(ctx.user.id, input), signal),
    ),

  delete: protectedProcedure
    .input(validate(Schema.Struct({ id: idSchema })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteCounterparty(ctx.user.id, input.id), signal),
    ),
});
