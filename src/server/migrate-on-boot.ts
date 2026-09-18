import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Escape hatch for hosts without a separate migration step: drop an empty
 * RUN_MIGRATIONS file next to server.js and the next boot applies the
 * committed migrations. Several processes (pm2 cluster) may boot at once, so
 * the work runs under a Postgres advisory lock, and the sentinel is removed
 * only after a successful run. Prefer "pnpm db:migrate" in the deploy.
 */
const SENTINEL = "RUN_MIGRATIONS";
const LOCK_KEY = 7_202_604_117;

export const migrateOnBoot = async (cwd = process.cwd()) => {
  const sentinel = path.join(cwd, SENTINEL);
  const url = process.env.DATABASE_URL;

  if (!existsSync(sentinel) || !url) {
    return false;
  }

  const sql = postgres(url, { max: 1, onnotice: () => false });

  try {
    await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;

    try {
      // another process may have finished while this one waited
      if (!existsSync(sentinel)) {
        return false;
      }

      await migrate(drizzle(sql), {
        migrationsFolder: path.join(cwd, "drizzle"),
        migrationsTable: "__drizzle_migrations",
        migrationsSchema: "public",
      });
      unlinkSync(sentinel);
      // biome-ignore lint/suspicious/noConsole: boot log
      console.log("[BOOT] migrations applied, RUN_MIGRATIONS removed");

      return true;
    } finally {
      await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
};
