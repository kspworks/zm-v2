import { eq, lt, sql } from "drizzle-orm";
import { Effect, Option } from "effect";

import { query } from "~/server/db/database";
import { rateLimits } from "~/server/db/schema";
import { Redis, type RedisClient, redisCommand } from "~/server/effect/redis";
import { now } from "~/server/lib/clock";
import { sha256 } from "~/server/lib/tokens";

export type RateLimitRule = { limit: number; windowMs: number };

const MINUTE = 60_000;

export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 15 * MINUTE },
  inviteOtp: { limit: 10, windowMs: 15 * MINUTE },
  resetRequest: { limit: 3, windowMs: 60 * MINUTE },
  resetSubmit: { limit: 10, windowMs: 15 * MINUTE },
  recoveryOtp: { limit: 10, windowMs: 15 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export const rateLimitKeys = {
  login: (email: string) => `login:email:${email.trim().toLowerCase()}`,
  inviteOtp: (inviteId: string) => `invite:otp:${inviteId}`,
  resetRequest: (email: string) => `reset:email:${email.trim().toLowerCase()}`,
  resetSubmit: (token: string) => `reset:token:${token}`,
  recoveryOtp: (linkId: string) => `recover:otp:${linkId}`,
  /** better-auth's own per-IP-and-path limiter (`rateLimit.customStorage`) */
  auth: (key: string) => `auth:${key}`,
};

/*
 * Two stores behind one contract. With REDIS_URL set, counters live in Redis
 * and expire there; without it, or for any call where Redis fails or is slow,
 * they live in the `rate_limits` table. A limit therefore never stops working
 * because Redis is down; while Redis flaps an attempt may be counted in either
 * store, so the worst case is twice the limit for that window.
 */

/** Hashed, so emails and reset tokens never appear in Redis as plaintext */
export const redisRateLimitKey = (key: string) => `zm:rl:${sha256(key)}`;

/**
 * One atomic step: count the attempt, and start the window on the first one.
 * The PTTL check (not INCR's result) also repairs a key that lost its TTL.
 */
const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

const hitRedis = (client: RedisClient, key: string, windowMs: number) =>
  Effect.map(
    redisCommand(client, (redis) =>
      redis.eval(FIXED_WINDOW_SCRIPT, {
        keys: [redisRateLimitKey(key)],
        arguments: [String(windowMs)],
      }),
    ),
    Number,
  );

/**
 * Counts one attempt against a fixed window in a single atomic upsert and
 * returns the post-increment count, so concurrent processes never lose
 * updates or race a read-then-write.
 */
const hitPostgres = Effect.fnUntraced(function* (
  key: string,
  windowMs: number,
) {
  const at = yield* now;
  // raw sql parameters bypass Drizzle's column mapping, so pass ISO strings
  const nowParam = sql`${at.toISOString()}::timestamptz`;
  const cutoff = sql`${new Date(at.getTime() - windowMs).toISOString()}::timestamptz`;

  const [row] = yield* query((db) =>
    db
      .insert(rateLimits)
      .values({ key, count: 1, windowStart: at })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`CASE WHEN ${rateLimits.windowStart} <= ${cutoff} THEN 1 ELSE ${rateLimits.count} + 1 END`,
          windowStart: sql`CASE WHEN ${rateLimits.windowStart} <= ${cutoff} THEN ${nowParam} ELSE ${rateLimits.windowStart} END`,
        },
      })
      .returning({ count: rateLimits.count }),
  );

  return row?.count ?? 1;
});

/**
 * Counts one attempt and returns the post-increment count: in Redis when it is
 * configured and answers, otherwise in Postgres.
 */
export const hitRateLimit = Effect.fn("rateLimit.hit")(function* (
  key: string,
  { limit, windowMs }: RateLimitRule,
) {
  const redis = yield* Redis;
  const count = Option.isSome(redis)
    ? yield* hitRedis(redis.value, key, windowMs).pipe(
        Effect.catchTag("RedisError", (error) =>
          Effect.andThen(
            Effect.logWarning(
              "rate limit: Redis unavailable, counting in Postgres",
              error.cause,
            ),
            hitPostgres(key, windowMs),
          ),
        ),
      )
    : yield* hitPostgres(key, windowMs);

  return { allowed: count <= limit, count };
});

/**
 * Clears the key in both stores, so a counter left in Postgres by an earlier
 * Redis outage can't block the user the next time the fallback is used.
 */
export const resetRateLimit = Effect.fn("rateLimit.reset")(function* (
  key: string,
) {
  const redis = yield* Redis;

  if (Option.isSome(redis)) {
    yield* redisCommand(redis.value, (client) =>
      client.del(redisRateLimitKey(key)),
    ).pipe(
      Effect.catchTag("RedisError", (error) =>
        Effect.logWarning("rate limit: Redis reset failed", error.cause),
      ),
    );
  }

  yield* query((db) => db.delete(rateLimits).where(eq(rateLimits.key, key)));
});

/**
 * Drops Postgres windows older than 24 h; run by the nightly cron. Redis keys
 * expire on their own.
 */
export const sweepRateLimits = Effect.fn("rateLimit.sweep")(function* () {
  const at = yield* now;
  const cutoff = new Date(at.getTime() - 24 * 60 * MINUTE);
  const deleted = yield* query((db) =>
    db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, cutoff))
      .returning({ key: rateLimits.key }),
  );

  return deleted.length;
});
