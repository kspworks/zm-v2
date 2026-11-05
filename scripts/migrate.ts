/**
 * Applies the committed migrations from "drizzle/" and exits - the Docker
 * deploys run it as its own step before the new app container replaces the old
 * one (see "compose.vps.yml" and "docker-compose.yml").
 *
 * Not "drizzle-kit migrate": the runtime image carries only the standalone
 * bundle, where drizzle-kit is absent and drizzle-orm and postgres live inside
 * server chunks rather than as modules. "pnpm build:scripts" bundles this file
 * with its dependencies into "build/migrate.mjs" instead.
 *
 * Importing "~/env" validates the whole runtime environment, so a broken
 * ".env" fails the deploy here, before the swap, rather than in the new
 * container.
 */
import { NodeRuntime } from "@effect/platform-node";
import { Clock, Effect } from "effect";

import { env } from "~/env";
import { applyMigrations, migrationClient } from "~/server/db/migrate";

const program = Effect.gen(function* () {
  const started = yield* Clock.currentTimeMillis;
  const sql = yield* migrationClient(env.DATABASE_URL);

  yield* applyMigrations(sql);

  const finished = yield* Clock.currentTimeMillis;

  // biome-ignore lint/suspicious/noConsole: a CLI script reports to stdout
  console.log(`migrations applied in ${finished - started}ms`);
}).pipe(
  Effect.scoped,
  Effect.tapError((error) =>
    // biome-ignore lint/suspicious/noConsole: a CLI script reports to stderr
    Effect.sync(() => console.error("migrations failed", error.cause)),
  ),
);

// exits 0 on success and 1 on failure, closing the connection either way
NodeRuntime.runMain(program, { disableErrorReporting: true });
