import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";

/**
 * drizzle's migrator takes no lock of its own: it wraps the batch in a
 * transaction, which gives atomicity but not mutual exclusion, so two runs
 * would read the same watermark and apply the same files. Every migration
 * run, wherever it starts from, holds this lock.
 */
const LOCK_KEY = 7_202_604_117;

export const withMigrationLock = async <T>(
  sql: postgres.Sql,
  work: () => Promise<T>,
): Promise<T> => {
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;

  try {
    return await work();
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
};

/** Applies the committed migrations in `<cwd>/drizzle`, without taking the lock */
export const migrateFolder = (sql: postgres.Sql, cwd: string) =>
  migrate(drizzle(sql), {
    migrationsFolder: path.join(cwd, "drizzle"),
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "public",
  });

export const applyMigrations = (sql: postgres.Sql, cwd = process.cwd()) =>
  withMigrationLock(sql, () => migrateFolder(sql, cwd));
