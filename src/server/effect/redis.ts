import { Context, Effect, Layer, Option, Schema } from "effect";
import { createClient } from "redis";

import { AppConfig } from "~/server/effect/app-config";

export type RedisClient = ReturnType<typeof createClient>;

/** A Redis command failed, timed out or found no live connection */
export class RedisError extends Schema.TaggedError<RedisError>()("RedisError", {
  cause: Schema.Defect(),
}) {}

/** How long a command may take before the caller falls back to Postgres */
const COMMAND_TIMEOUT = "250 millis";

/**
 * The optional Redis connection, `None` when `REDIS_URL` is unset. It only
 * ever holds data that can be lost (rate-limit counters): callers treat a
 * `RedisError` as "use Postgres for this call", never as a failure.
 *
 * The client connects in the background and never blocks the runtime build,
 * so a Redis that is down at boot (or later) leaves the app working. While
 * disconnected, commands fail immediately instead of queueing, and the client
 * keeps reconnecting with a capped backoff.
 */
export class Redis extends Context.Service<Redis, Option.Option<RedisClient>>()(
  "zm/server/effect/Redis",
) {
  static readonly layerFromUrl = (url: string | undefined) =>
    url
      ? Layer.effect(
          Redis,
          Effect.acquireRelease(
            Effect.sync(() => {
              const client: RedisClient = createClient({
                url,
                disableOfflineQueue: true,
                socket: {
                  connectTimeout: 2_000,
                  reconnectStrategy: (retries) =>
                    Math.min((retries + 1) * 200, 5_000),
                },
              });

              // without a listener node-redis rethrows connection errors and
              // takes the process down; outages surface per command instead
              client.on("error", () => undefined);
              // not awaited: the first connection retries in the background
              client.connect().catch(() => undefined);

              return Option.some(client);
            }),
            (client) =>
              Effect.sync(() => {
                if (Option.isSome(client) && client.value.isOpen) {
                  client.value.destroy();
                }
              }),
          ),
        )
      : Layer.succeed(Redis, Option.none());

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const { redisUrl } = yield* AppConfig;

      return Redis.layerFromUrl(redisUrl);
    }),
  );
}

/**
 * Runs one command on a ready connection, failing with `RedisError` when there
 * is none, when the command fails, or after the command timeout.
 */
export const redisCommand = <A>(
  client: RedisClient,
  run: (client: RedisClient) => Promise<A>,
): Effect.Effect<A, RedisError> =>
  Effect.suspend(() =>
    client.isReady
      ? Effect.timeoutOrElse(
          Effect.tryPromise({
            try: () => run(client),
            catch: (cause) => new RedisError({ cause }),
          }),
          {
            duration: COMMAND_TIMEOUT,
            orElse: () =>
              Effect.fail(new RedisError({ cause: "command timed out" })),
          },
        )
      : Effect.fail(new RedisError({ cause: "not connected" })),
  );
