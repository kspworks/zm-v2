import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

import { Effect } from "effect";

import {
  migrateFolder,
  migrationClient,
  withMigrationLock,
} from "~/server/db/migrate";

/**
 * Escape hatch for hosts without a separate migration step: drop an empty
 * RUN_MIGRATIONS file next to server.js and the next boot applies the
 * committed migrations. Several processes may boot at once, so the work runs
 * under the migration advisory lock, and the sentinel is removed only after a
 * successful run. Prefer a migration step in the deploy ("pnpm db:migrate",
 * or "node migrate.mjs" in the Docker image, whose read-only filesystem can't
 * hold the sentinel anyway).
 */
const SENTINEL = "RUN_MIGRATIONS";

const migrateIfRequested = Effect.fn("migrateOnBoot")(function* (cwd: string) {
  const sentinel = path.join(cwd, SENTINEL);
  // read raw: this runs at boot, before (and without) env validation
  const url = process.env.DATABASE_URL;

  if (!existsSync(sentinel) || !url) {
    return false;
  }

  const sql = yield* migrationClient(url);

  return yield* withMigrationLock(
    sql,
    Effect.gen(function* () {
      // another process may have finished while this one waited
      if (!existsSync(sentinel)) {
        return false;
      }

      yield* migrateFolder(sql, cwd);
      unlinkSync(sentinel);
      // biome-ignore lint/suspicious/noConsole: boot log
      console.log("[BOOT] migrations applied, RUN_MIGRATIONS removed");

      return true;
    }),
  );
}, Effect.scoped);

/** Called from instrumentation; resolves whether migrations ran */
export const migrateOnBoot = (cwd = process.cwd()) =>
  Effect.runPromise(migrateIfRequested(cwd));
