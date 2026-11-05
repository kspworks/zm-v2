import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Effect, Schema } from "effect";
import postgres from "postgres";

import { connectionOptions } from "~/server/db/connection";

/**
 * drizzle's migrator takes no lock of its own: it wraps the batch in a
 * transaction, which gives atomicity but not mutual exclusion, so two runs
 * would read the same watermark and apply the same files. Every migration
 * run, wherever it starts from, holds this lock.
 */
const LOCK_KEY = 7_202_604_117;

export class MigrationError extends Schema.TaggedError<MigrationError>()(
  "MigrationError",
  { cause: Schema.Defect() },
) {}

const attempt = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new MigrationError({ cause }),
  });

/** A dedicated single-connection client, closed when the scope closes */
export const migrationClient = (url: string) =>
  Effect.acquireRelease(
    Effect.sync(() => postgres(url, { ...connectionOptions(), max: 1 })),
    (sql) => Effect.promise(() => sql.end({ timeout: 5 })),
  );

/** Runs `work` holding the session-level migration lock on `sql` */
export const withMigrationLock = <A, E, R>(
  sql: postgres.Sql,
  work: Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    attempt(() => sql`SELECT pg_advisory_lock(${LOCK_KEY})`),
    () => work,
    () =>
      attempt(() => sql`SELECT pg_advisory_unlock(${LOCK_KEY})`).pipe(
        Effect.ignore,
      ),
  );

/** Applies the committed migrations in `<cwd>/drizzle`, without taking the lock */
export const migrateFolder = (sql: postgres.Sql, cwd: string) =>
  attempt(() =>
    migrate(drizzle(sql), {
      migrationsFolder: path.join(cwd, "drizzle"),
      migrationsTable: "__drizzle_migrations",
      migrationsSchema: "public",
    }),
  );

export const applyMigrations = (sql: postgres.Sql, cwd = process.cwd()) =>
  withMigrationLock(sql, migrateFolder(sql, cwd));
