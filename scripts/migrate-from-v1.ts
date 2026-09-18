/**
 * Copies a ZM v1 database into an empty, migrated v2 database.
 *
 *   OLD_DATABASE_URL=postgres://… DATABASE_URL=postgres://… \
 *   BETTER_AUTH_SECRET=… pnpm tsx scripts/migrate-from-v1.ts
 *
 * BETTER_AUTH_SECRET must be the production one: 2FA secrets are encrypted
 * with it. Runs in one transaction and refuses a target that has users.
 */
import postgres from "postgres";

import { db } from "~/server/db";
import { migrateFromV1 } from "~/server/migration/from-v1";

const main = async () => {
  const oldUrl = process.env.OLD_DATABASE_URL;

  if (!oldUrl || !process.env.DATABASE_URL) {
    throw new Error("Set OLD_DATABASE_URL and DATABASE_URL");
  }

  const old = postgres(oldUrl, { max: 1, onnotice: () => undefined });

  try {
    // biome-ignore lint/suspicious/noConsole: a CLI script reports to stdout
    await migrateFromV1(old, db, (line) => console.log(line));
  } finally {
    await old.end({ timeout: 5 });
  }
};

main().then(
  () => process.exit(0),
  (error: unknown) => {
    // biome-ignore lint/suspicious/noConsole: a CLI script reports to stderr
    console.error(error);
    process.exit(1);
  },
);
