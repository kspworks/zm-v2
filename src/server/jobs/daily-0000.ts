import { lt } from "drizzle-orm";
import type { CronLog } from "~/server/cron";
import type { DbOrTx } from "~/server/db";
import { authRateLimits } from "~/server/db/schema";
import { now, today } from "~/server/lib/clock";
import { sweepRateLimits } from "~/server/lib/rate-limit";
import { regenerateAll } from "~/server/services/planned";

/** Midnight: roll the one-year planned window forward, sweep old limits */
export const dailyMidnight = async (db: DbOrTx, log: CronLog) => {
  const day = today();
  const generated = await regenerateAll(db, day);
  log(
    `planned: ${generated.occurrences} occurrences for ${generated.schedules} schedules (today ${day})`,
  );

  const swept = await sweepRateLimits(db);
  const cutoff = now().getTime() - 24 * 60 * 60 * 1000;
  const sweptAuth = await db
    .delete(authRateLimits)
    .where(lt(authRateLimits.lastRequest, cutoff))
    .returning({ id: authRateLimits.id });
  log(`rate limits: swept ${swept} app and ${sweptAuth.length} auth windows`);
};
