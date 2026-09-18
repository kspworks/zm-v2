import { z } from "zod";

import {
  accountInputSchema,
  accountUpdateSchema,
} from "~/lib/validators/accounts";
import { idSchema } from "~/lib/validators/common";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  listCurrencies,
  setAccountActive,
  updateAccount,
} from "~/server/services/accounts";

export const accountsRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    listAccounts(ctx.db, ctx.user.id),
  ),

  currencies: protectedProcedure.query(({ ctx }) => listCurrencies(ctx.db)),

  create: protectedProcedure
    .input(accountInputSchema)
    .mutation(({ ctx, input }) => createAccount(ctx.db, ctx.user.id, input)),

  update: protectedProcedure
    .input(accountUpdateSchema)
    .mutation(({ ctx, input }) => updateAccount(ctx.db, ctx.user.id, input)),

  setActive: protectedProcedure
    .input(z.object({ id: idSchema, isActive: z.boolean() }))
    .mutation(({ ctx, input }) => setAccountActive(ctx.db, ctx.user.id, input)),

  delete: protectedProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) => deleteAccount(ctx.db, ctx.user.id, input.id)),
});
