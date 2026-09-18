import { z } from "zod";

import { idSchema, trimmedName } from "~/lib/validators/common";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  counterpartyBalances,
  deleteCounterparty,
  listCounterparties,
  mergeCounterparties,
  renameCounterparty,
} from "~/server/services/counterparties";

export const counterpartiesRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    listCounterparties(ctx.db, ctx.user.id),
  ),

  balances: protectedProcedure.query(({ ctx }) =>
    counterpartyBalances(ctx.db, ctx.user.id),
  ),

  rename: protectedProcedure
    .input(z.object({ id: idSchema, name: trimmedName }))
    .mutation(({ ctx, input }) =>
      renameCounterparty(ctx.db, ctx.user.id, input),
    ),

  merge: protectedProcedure
    .input(z.object({ sourceId: idSchema, targetId: idSchema }))
    .mutation(({ ctx, input }) =>
      mergeCounterparties(ctx.db, ctx.user.id, input),
    ),

  delete: protectedProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) =>
      deleteCounterparty(ctx.db, ctx.user.id, input.id),
    ),
});
