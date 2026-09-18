import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { now } from "~/server/lib/clock";

export const healthRouter = createTRPCRouter({
  ping: publicProcedure.query(() => ({ ok: true, at: now() })),
});
