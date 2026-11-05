import { eq, sql } from "drizzle-orm";

import { type DbOrTx, db as defaultDb } from "~/server/db";
import { rateLimits } from "~/server/db/schema";
import { now } from "~/server/legacy/clock";

import type { RateLimitRule } from "~/server/lib/rate-limit";

/**
 * Counts one attempt against a fixed window in a single atomic upsert and
 * returns the post-increment count, so concurrent processes never lose
 * updates or race a read-then-write.
 */
export const hitRateLimit = async (
  key: string,
  { limit, windowMs }: RateLimitRule,
  db: DbOrTx = defaultDb,
): Promise<{ allowed: boolean; count: number }> => {
  const at = now();
  // raw sql parameters bypass Drizzle's column mapping, so pass ISO strings
  const nowParam = sql`${at.toISOString()}::timestamptz`;
  const cutoff = sql`${new Date(at.getTime() - windowMs).toISOString()}::timestamptz`;

  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: at })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} <= ${cutoff} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${rateLimits.windowStart} <= ${cutoff} THEN ${nowParam} ELSE ${rateLimits.windowStart} END`,
      },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? 1;

  return { allowed: count <= limit, count };
};

export const resetRateLimit = async (
  key: string,
  db: DbOrTx = defaultDb,
): Promise<void> => {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
};
