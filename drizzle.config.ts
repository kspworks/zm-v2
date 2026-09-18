import path from "node:path";

import type { Config } from "drizzle-kit";
import type { MigrationConfig } from "drizzle-orm/migrator";

const migrations = {
  table: "__drizzle_migrations",
  schema: "public",
} as const;

export const migrationConfig: MigrationConfig = {
  migrationsFolder: path.join(process.cwd(), "drizzle"),
  migrationsTable: migrations.table,
  migrationsSchema: migrations.schema,
};

export default {
  migrations,
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    // drizzle-kit runs outside Next, so read the raw variable
    url: process.env.DATABASE_URL ?? "",
  },
} satisfies Config;
