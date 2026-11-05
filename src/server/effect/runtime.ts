import { Cause, type Effect, Exit, Layer, ManagedRuntime } from "effect";

import { Database, type SqlError } from "~/server/db/database";
import { AppConfig } from "~/server/effect/app-config";
import { Mailer } from "~/server/effect/mailer";
import { toTRPCError } from "~/server/effect/to-trpc-error";
import type { AppError } from "~/server/lib/errors";

/** Every service the server's Effect code may require */
export const AppLayer = Layer.mergeAll(
  Database.layer,
  AppConfig.layer,
  Mailer.layer.pipe(Layer.provide(AppConfig.layer)),
);

export type AppServices = Layer.Success<typeof AppLayer>;

type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>;

/**
 * One runtime per process. Cached on globalThis outside production, like the
 * pool, so HMR and vitest's shared module graph don't rebuild it. It holds no
 * mutable application state: rate limits and locks stay in Postgres.
 */
const globalForRuntime = globalThis as unknown as {
  zmRuntime: AppRuntime | undefined;
};

export const runtime: AppRuntime =
  globalForRuntime.zmRuntime ?? ManagedRuntime.make(AppLayer);

if (process.env.NODE_ENV !== "production") {
  globalForRuntime.zmRuntime = runtime;
}

/** Runs a procedure's effect; failures become the matching TRPCError */
export const runForTrpc = async <A>(
  effect: Effect.Effect<A, AppError | SqlError, AppServices>,
  signal?: AbortSignal,
): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect, { signal });

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  throw toTRPCError(exit.cause);
};

/**
 * Runs an effect from a non-tRPC edge (server components, better-auth hooks,
 * cron routes). Handle expected errors with Effect.catchTag before running:
 * anything left is thrown as-is.
 */
export const runServer = async <A, E>(
  effect: Effect.Effect<A, E, AppServices>,
): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect);

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  throw Cause.squash(exit.cause);
};
