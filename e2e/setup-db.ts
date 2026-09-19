import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { migrationConfig } from "../drizzle.config";
import { ensureTestDatabase } from "../tests/helpers/test-db";
import { E2E_DATABASE_URL } from "./env";

/**
 * Recreates the throwaway e2e database, so a run never inherits rows from the
 * last one. It lives on the Vitest postgres (docker-compose.test.yml) but in
 * its own database, so the unit tests' TRUNCATE never pulls rows out from
 * under a running browser. Runs as the first step of the webServer command:
 * Playwright starts the server before any global setup would run.
 */

const target = new URL(E2E_DATABASE_URL);
const name = target.pathname.slice(1);

// dropped on every run, so never let this point at a real database
if (name !== "zm_e2e") {
  throw new Error(`Refusing to recreate ${E2E_DATABASE_URL}`);
}

// any existing database will do for DROP/CREATE; "postgres" always exists
const maintenance = new URL(target);
maintenance.pathname = "/postgres";

await ensureTestDatabase(maintenance.toString());

const admin = postgres(maintenance.toString(), {
  max: 1,
  onnotice: () => false,
});

try {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${name}"`);
} finally {
  await admin.end({ timeout: 5 });
}

const client = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => false });

try {
  // also seeds the currencies table
  await migrate(drizzle(client), migrationConfig);
} finally {
  await client.end({ timeout: 5 });
}

// biome-ignore lint/suspicious/noConsole: script output
console.log(`E2E database ready at ${E2E_DATABASE_URL}`);
