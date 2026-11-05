import { z } from "zod";

import { idSchema, trimmedName } from "~/lib/validators/common";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
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
    .input(z.object({ id: idSchema, name: trimmedName }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(renameCounterparty(ctx.user.id, input), signal),
    ),

  merge: protectedProcedure
    .input(z.object({ sourceId: idSchema, targetId: idSchema }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(mergeCounterparties(ctx.user.id, input), signal),
    ),

  delete: protectedProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteCounterparty(ctx.user.id, input.id), signal),
    ),
});
