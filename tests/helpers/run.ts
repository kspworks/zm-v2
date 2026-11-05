import type { Effect } from "effect";

import type { SqlError } from "~/server/db/database";
import { type AppServices, runForTrpc } from "~/server/effect/runtime";
import type { AppError } from "~/server/lib/errors";

/**
 * Runs a service effect on the app runtime, mapping failures exactly as a
 * procedure would, so `expectTRPCError(run(...), code, key)` asserts the same
 * stable contract (transport code + message key) as a caller test.
 */
export const run = <A>(
  effect: Effect.Effect<A, AppError | SqlError, AppServices>,
): Promise<A> => runForTrpc(effect);
