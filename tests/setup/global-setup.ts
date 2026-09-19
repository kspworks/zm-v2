import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { migrationConfig } from "../../drizzle.config";
import { ensureTestDatabase } from "../helpers/test-db";

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is missing - is .env.test present?");
  }

  // every test truncates the whole schema, so never let this point at a real db
  if (!url.includes("zm_test")) {
    throw new Error(`Refusing to run destructive tests against ${url}`);
  }

  await ensureTestDatabase(url);

  const client = postgres(url, { max: 1, onnotice: () => false });

  try {
    // idempotent via __drizzle_migrations; also seeds the currencies table
    await migrate(drizzle(client), migrationConfig);
  } finally {
    await client.end({ timeout: 5 });
  }
}
