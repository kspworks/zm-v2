import { assert, describe, it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";

import { type Database, query, transaction } from "~/server/db/database";
import { rateLimits } from "~/server/db/schema";
import { AppLayer } from "~/server/effect/runtime";
import { BadRequest, badRequest } from "~/server/lib/errors";

/**
 * Contract of `transaction`: commit on success; roll back on a typed failure,
 * a defect or an interruption, which propagate unchanged; nested calls are
 * SAVEPOINTs that roll back alone.
 */
const insertKey = (key: string) =>
  query((db) =>
    db.insert(rateLimits).values({ key, count: 1, windowStart: new Date() }),
  );

const keyExists = (key: string) =>
  query((db) =>
    db.select().from(rateLimits).where(eq(rateLimits.key, key)),
  ).pipe(Effect.map((rows) => rows.length === 1));

const provide = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.provide(effect, AppLayer);

describe("transaction", () => {
  it.effect("commits on success", () =>
    provide(
      Effect.gen(function* () {
        const value = yield* transaction(
          insertKey("commit").pipe(Effect.as(42)),
        );

        assert.strictEqual(value, 42);
        assert.isTrue(yield* keyExists("commit"));
      }),
    ),
  );

  it.effect("rolls back on a typed failure and keeps the error", () =>
    provide(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          transaction(
            Effect.andThen(
              insertKey("typed"),
              Effect.fail(badRequest("forbidden")),
            ),
          ),
        );

        assert.isTrue(Exit.isFailure(exit));
        const error = Exit.findErrorOption(exit);
        assert.isTrue(
          error._tag === "Some" && error.value instanceof BadRequest,
        );
        assert.isFalse(yield* keyExists("typed"));
      }),
    ),
  );

  it.effect("rolls back on a defect and keeps the defect", () =>
    provide(
      Effect.gen(function* () {
        const boom = new Error("boom");
        const exit = yield* Effect.exit(
          transaction(Effect.andThen(insertKey("defect"), Effect.die(boom))),
        );

        assert.isTrue(Exit.isFailure(exit) && Exit.hasDies(exit));
        assert.strictEqual(
          Exit.isFailure(exit) ? Cause.squash(exit.cause) : null,
          boom,
        );
        assert.isFalse(yield* keyExists("defect"));
      }),
    ),
  );

  it.live("rolls back when interrupted", () =>
    provide(
      Effect.gen(function* () {
        const inserted = yield* Deferred.make<void>();
        const fiber = yield* Effect.forkChild(
          transaction(
            Effect.andThen(
              insertKey("interrupt"),
              Effect.andThen(
                Deferred.succeed(inserted, undefined),
                Effect.never,
              ),
            ),
          ),
        );

        yield* Deferred.await(inserted);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);

        assert.isTrue(Exit.hasInterrupts(exit));
        assert.isFalse(yield* keyExists("interrupt"));
      }),
    ),
  );

  it.effect("rolls back a nested transaction alone", () =>
    provide(
      Effect.gen(function* () {
        yield* transaction(
          Effect.gen(function* () {
            yield* insertKey("outer");
            yield* transaction(
              Effect.andThen(
                insertKey("inner"),
                Effect.fail(badRequest("forbidden")),
              ),
            ).pipe(Effect.ignore);
          }),
        );

        assert.isTrue(yield* keyExists("outer"));
        assert.isFalse(yield* keyExists("inner"));
      }),
    ),
  );
});
