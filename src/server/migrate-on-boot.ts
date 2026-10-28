import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

import { connectionOptions } from "~/server/db/connection";
import { migrateFolder, withMigrationLock } from "~/server/db/migrate";

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

export const migrateOnBoot = async (cwd = process.cwd()) => {
  const sentinel = path.join(cwd, SENTINEL);
  const url = process.env.DATABASE_URL;

  if (!existsSync(sentinel) || !url) {
    return false;
  }

  const sql = postgres(url, { ...connectionOptions(), max: 1 });

  try {
    return await withMigrationLock(sql, async () => {
      // another process may have finished while this one waited
      if (!existsSync(sentinel)) {
        return false;
      }

      await migrateFolder(sql, cwd);
      unlinkSync(sentinel);
      // biome-ignore lint/suspicious/noConsole: boot log
      console.log("[BOOT] migrations applied, RUN_MIGRATIONS removed");

      return true;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
};
