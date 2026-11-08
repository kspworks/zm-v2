import { accountsRouter } from "~/server/api/routers/accounts";
import { adminRouter } from "~/server/api/routers/admin";
import { budgetsRouter } from "~/server/api/routers/budgets";
import { categoriesRouter } from "~/server/api/routers/categories";
import { counterpartiesRouter } from "~/server/api/routers/counterparties";
import { dashboardRouter } from "~/server/api/routers/dashboard";
import { exportsRouter } from "~/server/api/routers/exports";
import { healthRouter } from "~/server/api/routers/health";
import { historyRouter } from "~/server/api/routers/history";
import { importsRouter } from "~/server/api/routers/imports";
import { invitesRouter } from "~/server/api/routers/invites";
import { meRouter } from "~/server/api/routers/me";
import { plannedRouter } from "~/server/api/routers/planned";
import { recoveryRouter } from "~/server/api/routers/recovery";
import { reportsRouter } from "~/server/api/routers/reports";
import { settingsRouter } from "~/server/api/routers/settings";
import { sharingRouter } from "~/server/api/routers/sharing";
import { transactionsRouter } from "~/server/api/routers/transactions";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  accounts: accountsRouter,
  admin: adminRouter,
  budgets: budgetsRouter,
  categories: categoriesRouter,
  counterparties: counterpartiesRouter,
  dashboard: dashboardRouter,
  exports: exportsRouter,
  health: healthRouter,
  history: historyRouter,
  imports: importsRouter,
  invites: invitesRouter,
  me: meRouter,
  planned: plannedRouter,
  recovery: recoveryRouter,
  reports: reportsRouter,
  settings: settingsRouter,
  sharing: sharingRouter,
  transactions: transactionsRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
