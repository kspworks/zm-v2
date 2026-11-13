import { sql } from "drizzle-orm";

import { db } from "~/server/db";

/** A transaction comment Postgres refuses inside `refusingComment` */
export const REFUSED_COMMENT = "zm-test-refused";

/**
 * Makes Postgres refuse every transaction row commented `REFUSED_COMMENT`
 * while `body` runs: a stand-in for a schedule whose generation fails in the
 * database.
 */
export const refusingComment = async <T>(body: () => Promise<T>) => {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION zm_test_refuse_comment() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.comment = 'zm-test-refused' THEN
        RAISE EXCEPTION 'refused by test';
      END IF;
      RETURN NEW;
    END $$
  `);
  await db.execute(sql`
    CREATE TRIGGER zm_test_refuse_comment BEFORE INSERT ON transactions
    FOR EACH ROW EXECUTE FUNCTION zm_test_refuse_comment()
  `);

  try {
    return await body();
  } finally {
    await db.execute(
      sql`DROP TRIGGER IF EXISTS zm_test_refuse_comment ON transactions`,
    );
    await db.execute(sql`DROP FUNCTION IF EXISTS zm_test_refuse_comment()`);
  }
};
