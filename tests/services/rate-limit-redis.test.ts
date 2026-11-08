import { assert, layer } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";

import { Database, query } from "~/server/db/database";
import { rateLimits } from "~/server/db/schema";
import { Redis, type RedisClient } from "~/server/effect/redis";
import {
  hitRateLimit,
  postgresRateLimitKey,
  redisRateLimitKey,
  resetRateLimit,
} from "~/server/lib/rate-limit";

/**
 * Contract of the Redis rate-limit store and its Postgres fallback, against
 * the redis from docker-compose.test.yml. Live services: Redis expires keys on
 * its own clock, so TestClock would only skew the Postgres side.
 */

const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "";
const rule = { limit: 3, windowMs: 60_000 };

const client = Effect.gen(function* () {
  const redis = yield* Redis;

  if (Option.isNone(redis)) {
    return yield* Effect.die("the test layer has no Redis");
  }

  return redis.value;
});

/** The client connects in the background; tests start once it is ready */
const waitUntilReady = Layer.effectDiscard(
  Effect.gen(function* () {
    const redis = yield* client;

    while (!redis.isReady) {
      yield* Effect.sleep("20 millis");
    }

    yield* Effect.promise(() => redis.flushDb());
  }).pipe(Effect.timeout("10 seconds"), Effect.orDie),
);

const withRedis = (run: (redis: RedisClient) => Promise<unknown>) =>
  Effect.flatMap(client, (redis) => Effect.promise(() => run(redis)));

const pgRow = (key: string) =>
  query((db) =>
    db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.key, postgresRateLimitKey(key))),
  );

layer(
  Layer.mergeAll(
    Database.layer,
    waitUntilReady.pipe(Layer.provideMerge(Redis.layerFromUrl(TEST_REDIS_URL))),
  ),
  { excludeTestServices: true },
)("rate limits in Redis", (it) => {
  it.effect("counts attempts and blocks past the limit", () =>
    Effect.gen(function* () {
      yield* withRedis((redis) => redis.flushDb());

      const counts = [];

      for (let i = 0; i < 4; i++) {
        counts.push(yield* hitRateLimit("k", rule));
      }

      assert.deepStrictEqual(
        counts.map((r) => [r.count, r.allowed]),
        [
          [1, true],
          [2, true],
          [3, true],
          [4, false],
        ],
      );
      // healthy Redis: nothing reaches Postgres
      assert.lengthOf(yield* pgRow("k"), 0);
    }),
  );

  it.effect("keeps keys apart", () =>
    Effect.gen(function* () {
      yield* withRedis((redis) => redis.flushDb());

      yield* hitRateLimit("a", rule);
      yield* hitRateLimit("a", rule);

      assert.strictEqual((yield* hitRateLimit("b", rule)).count, 1);
    }),
  );

  it.effect("counts concurrent attempts atomically", () =>
    Effect.gen(function* () {
      yield* withRedis((redis) => redis.flushDb());

      const results = yield* Effect.all(
        Array.from({ length: 50 }, () =>
          hitRateLimit("race", { limit: 100, windowMs: 60_000 }),
        ),
        { concurrency: "unbounded" },
      );

      assert.deepStrictEqual(
        results.map((r) => r.count).sort((a, b) => a - b),
        Array.from({ length: 50 }, (_, i) => i + 1),
      );
    }),
  );

  it.effect("starts the window on the first attempt", () =>
    Effect.gen(function* () {
      yield* withRedis((redis) => redis.flushDb());

      yield* hitRateLimit("ttl", rule);
      const ttl = Number(
        yield* withRedis((redis) => redis.pTTL(redisRateLimitKey("ttl"))),
      );

      assert.isAbove(ttl, 0);
      assert.isAtMost(ttl, rule.windowMs);
    }),
  );

  it.effect("stores no plaintext key", () =>
    Effect.gen(function* () {
      yield* withRedis((redis) => redis.flushDb());

      yield* hitRateLimit("login:email:someone@example.com", rule);
      const keys = (yield* withRedis((redis) => redis.keys("*"))) as string[];

      assert.lengthOf(keys, 1);
      assert.notInclude(keys[0], "someone@example.com");
    }),
  );

  it.effect("reset clears the key in Redis and in Postgres", () =>
    Effect.gen(function* () {
      yield* withRedis((redis) => redis.flushDb());

      yield* hitRateLimit("k", rule);
      yield* hitRateLimit("k", rule);
      // a counter left behind by an earlier outage
      yield* query((db) =>
        db
          .insert(rateLimits)
          .values({ key: "k", count: 9, windowStart: new Date() }),
      );

      yield* resetRateLimit("k");

      assert.lengthOf(yield* pgRow("k"), 0);
      assert.strictEqual((yield* hitRateLimit("k", rule)).count, 1);
    }),
  );
});

// nothing listens on port 1, so the client never becomes ready
layer(
  Layer.mergeAll(Database.layer, Redis.layerFromUrl("redis://127.0.0.1:1")),
  { excludeTestServices: true },
)("rate limits while Redis is down", (it) => {
  it.effect("fall back to Postgres and keep limiting", () =>
    Effect.gen(function* () {
      const counts = [];

      for (let i = 0; i < 4; i++) {
        counts.push(yield* hitRateLimit("down", rule));
      }

      assert.deepStrictEqual(
        counts.map((r) => r.allowed),
        [true, true, true, false],
      );

      const [row] = yield* pgRow("down");
      assert.strictEqual(row?.count, 4);
    }),
  );

  it.effect("still reset in Postgres", () =>
    Effect.gen(function* () {
      yield* hitRateLimit("down", rule);
      yield* resetRateLimit("down");

      assert.lengthOf(yield* pgRow("down"), 0);
    }),
  );
});
