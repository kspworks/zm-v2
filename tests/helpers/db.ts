import { sql } from "drizzle-orm";

import { db } from "~/server/db";

/** Seeded by a migration and never written by the app, so it survives cleanup */
const PRESERVED_TABLES = new Set(["currencies", "__drizzle_migrations"]);

let truncateStatement: string | null = null;

/**
 * Wipes every table between tests. The table list comes from the database
 * itself, so tables added by later migrations are picked up automatically.
 */
export const truncateAll = async (): Promise<void> => {
  if (truncateStatement === null) {
    const rows = await db.execute<{ tablename: string }>(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);

    const tables = [...rows]
      .map(({ tablename }) => tablename)
      .filter((name) => !PRESERVED_TABLES.has(name));

    if (tables.length === 0) {
      truncateStatement = "SELECT 1";
    } else {
      truncateStatement = `TRUNCATE TABLE ${tables
        .map((name) => `"${name}"`)
        .join(", ")} RESTART IDENTITY CASCADE`;
    }
  }

  await db.execute(sql.raw(truncateStatement));
};
