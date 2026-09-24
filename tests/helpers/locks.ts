import { sql } from "drizzle-orm";

import { db } from "~/server/db";

/** A promise plus the function that resolves it */
export const signal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

/**
 * Resolves once another session of this database is blocked on a row lock,
 * so a test can commit the holder only after the other side is waiting.
 */
export const untilBlockedOnLock = async () => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const [row] = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `);

    if (row && row.waiting > 0) {
      return;
    }

    await new Promise((done) => setTimeout(done, 10));
  }

  throw new Error("no session ever waited on a lock");
};
