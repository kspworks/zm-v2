import { healthRouter } from "~/server/api/routers/health";
import { invitesRouter } from "~/server/api/routers/invites";
import { meRouter } from "~/server/api/routers/me";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  health: healthRouter,
  invites: invitesRouter,
  me: meRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
