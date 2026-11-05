import { Effect } from "effect";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import { now } from "~/server/lib/clock";

export const healthRouter = createTRPCRouter({
  ping: publicProcedure.query(({ signal }) =>
    runForTrpc(
      Effect.map(now, (at) => ({ ok: true, at })),
      signal,
    ),
  ),
});
