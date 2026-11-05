/**
 * Copies a ZM v1 database into an empty, migrated v2 database.
 *
 *   OLD_DATABASE_URL=postgres://… DATABASE_URL=postgres://… \
 *   BETTER_AUTH_SECRET=… pnpm tsx scripts/migrate-from-v1.ts
 *
 * BETTER_AUTH_SECRET must be the production one: 2FA secrets are encrypted
 * with it. Runs in one transaction and refuses a target that has users.
 */
import { NodeRuntime } from "@effect/platform-node";
import { Config, Effect } from "effect";
import postgres from "postgres";

import { Database } from "~/server/db/database";
import { migrateFromV1 } from "~/server/migration/from-v1";

const program = Effect.gen(function* () {
  const oldUrl = yield* Config.String("OLD_DATABASE_URL");
  yield* Config.String("DATABASE_URL");

  const old = yield* Effect.acquireRelease(
    Effect.sync(() => postgres(oldUrl, { max: 1, onnotice: () => undefined })),
    (sql) => Effect.promise(() => sql.end({ timeout: 5 })),
  );

  // biome-ignore lint/suspicious/noConsole: a CLI script reports to stdout
  yield* migrateFromV1(old, (line) => console.log(line));
}).pipe(Effect.scoped, Effect.provide(Database.layer));

// exits 0 on success; a missing variable or any failure is logged, exit 1
NodeRuntime.runMain(program);
