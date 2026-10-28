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
import postgres from "postgres";

import { env } from "~/env";
import { connectionOptions } from "~/server/db/connection";
import { applyMigrations } from "~/server/db/migrate";

const sql = postgres(env.DATABASE_URL, { ...connectionOptions(), max: 1 });

let exitCode = 0;

try {
  const started = Date.now();

  await applyMigrations(sql);
  // biome-ignore lint/suspicious/noConsole: a CLI script reports to stdout
  console.log(`migrations applied in ${Date.now() - started}ms`);
} catch (error) {
  // biome-ignore lint/suspicious/noConsole: a CLI script reports to stderr
  console.error("migrations failed", error);
  exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

process.exit(exitCode);
