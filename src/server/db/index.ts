import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "~/env";
import { connectionOptions } from "~/server/db/connection";
import * as schema from "~/server/db/schema";

/**
 * Cache the connection in development and tests: HMR (and vitest's module
 * resets between files) would otherwise open a new pool on every reload.
 */
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const conn =
  globalForDb.conn ??
  postgres(env.DATABASE_URL, {
    ...connectionOptions(),
    // lets forked test workers and idle serverless functions exit
    idle_timeout: 20,
  });

if (env.NODE_ENV !== "production") {
  globalForDb.conn = conn;
}

export const db = drizzle(conn, {
  schema,
  casing: "snake_case",
  logger: String(env.DATABASE_LOG) === "true",
});

export type Db = typeof db;
/** A transaction handle: services accept one so they compose inside a caller's tx */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
