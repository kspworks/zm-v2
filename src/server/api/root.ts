import { accountsRouter } from "~/server/api/routers/accounts";
import { categoriesRouter } from "~/server/api/routers/categories";
import { counterpartiesRouter } from "~/server/api/routers/counterparties";
import { healthRouter } from "~/server/api/routers/health";
import { importsRouter } from "~/server/api/routers/imports";
import { invitesRouter } from "~/server/api/routers/invites";
import { meRouter } from "~/server/api/routers/me";
import { plannedRouter } from "~/server/api/routers/planned";
import { reportsRouter } from "~/server/api/routers/reports";
import { sharingRouter } from "~/server/api/routers/sharing";
import { transactionsRouter } from "~/server/api/routers/transactions";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  accounts: accountsRouter,
  categories: categoriesRouter,
  counterparties: counterpartiesRouter,
  health: healthRouter,
  imports: importsRouter,
  invites: invitesRouter,
  me: meRouter,
  planned: plannedRouter,
  reports: reportsRouter,
  sharing: sharingRouter,
  transactions: transactionsRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
