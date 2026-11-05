import { Context, Effect, Exit, Layer, Schema } from "effect";

import { type DbOrTx, db } from "~/server/db";
import { isUniqueViolation } from "~/server/lib/errors";

/**
 * The current Drizzle handle: the pool, or the transaction an enclosing
 * `transaction(...)` opened. Services never take a handle parameter; they run
 * their statements through `query`, which reads this service.
 */
export class Database extends Context.Service<Database, DbOrTx>()(
  "zm/server/db/Database",
) {
  static readonly layer = Layer.succeed(Database, db);
}

/** A statement failed in Postgres or the driver; surfaced as a 500 */
export class SqlError extends Schema.TaggedError<SqlError>()("SqlError", {
  cause: Schema.Defect(),
}) {}

/** Runs one Drizzle statement (or any promise) against the current handle */
export const query = <A>(
  run: (db: DbOrTx) => PromiseLike<A>,
): Effect.Effect<A, SqlError, Database> =>
  Effect.flatMap(Database, (handle) =>
    Effect.tryPromise({
      try: () => run(handle),
      catch: (cause) => new SqlError({ cause }),
    }),
  );

/** Carries the inner fiber's exit out of Drizzle's callback to roll back */
class Rollback {
  constructor(readonly exit: Exit.Exit<unknown, unknown>) {}
}

/**
 * Runs `effect` in one database transaction: commit on success, roll back on
 * any failure, defect or interruption, which then propagates unchanged. Nested
 * calls become SAVEPOINTs, so a service's own transaction composes into its
 * caller's.
 */
export const transaction = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | SqlError, R | Database> =>
  Effect.gen(function* () {
    const handle = yield* Database;
    const context = yield* Effect.context<R | Database>();
    const runInner = Effect.runPromiseExitWith(context);

    const outcome = yield* Effect.tryPromise({
      try: (signal) =>
        handle
          .transaction(async (tx) => {
            const exit = await runInner(
              Effect.provideService(effect, Database, tx),
              { signal },
            );

            if (Exit.isFailure(exit)) {
              throw new Rollback(exit);
            }

            return exit;
          })
          .catch((error: unknown) => {
            if (error instanceof Rollback) {
              return error.exit as Exit.Exit<A, E>;
            }

            throw error;
          }),
      catch: (cause) => new SqlError({ cause }),
    });

    return yield* outcome;
  });

/**
 * Turns a unique-constraint violation into a business error, e.g.
 * `catchUniqueViolation("accounts_name_unique", () => badRequest("…"))`.
 * Any other SqlError passes through.
 */
export const catchUniqueViolation =
  <E2>(constraint: string | undefined, onViolation: () => E2) =>
  <A, E, R>(
    self: Effect.Effect<A, E | SqlError, R>,
  ): Effect.Effect<A, E | E2 | SqlError, R> =>
    Effect.catchIf(
      self,
      (error: E | SqlError): boolean =>
        error instanceof SqlError && isUniqueViolation(error.cause, constraint),
      () => Effect.fail(onViolation()),
    );
