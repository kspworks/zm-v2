import { z } from "zod";

import {
  accountInputSchema,
  accountUpdateSchema,
} from "~/lib/validators/accounts";
import { idSchema } from "~/lib/validators/common";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  listCurrencies,
  setAccountActive,
  updateAccount,
} from "~/server/services/accounts";

export const accountsRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx, signal }) =>
    runForTrpc(listAccounts(ctx.user.id), signal),
  ),

  currencies: protectedProcedure.query(({ signal }) =>
    runForTrpc(listCurrencies(), signal),
  ),

  create: protectedProcedure
    .input(accountInputSchema)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(createAccount(ctx.user.id, input), signal),
    ),

  update: protectedProcedure
    .input(accountUpdateSchema)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(updateAccount(ctx.user.id, input), signal),
    ),

  setActive: protectedProcedure
    .input(z.object({ id: idSchema, isActive: z.boolean() }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(setAccountActive(ctx.user.id, input), signal),
    ),

  delete: protectedProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteAccount(ctx.user.id, input.id), signal),
    ),
});
