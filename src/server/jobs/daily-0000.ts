import { lt } from "drizzle-orm";
import { Effect } from "effect";

import { query } from "~/server/db/database";
import { authRateLimits } from "~/server/db/schema";
import { now, today } from "~/server/lib/clock";
import { sweepRateLimits } from "~/server/lib/rate-limit";
import { regenerateAll } from "~/server/services/planned";

/** Midnight: roll the one-year planned window forward, sweep old limits */
export const dailyMidnight = Effect.fn("jobs.dailyMidnight")(function* () {
  const day = yield* today;
  const generated = yield* regenerateAll(day);
  yield* Effect.log(
    `planned: ${generated.occurrences} occurrences for ${generated.schedules} schedules (today ${day})`,
  );

  if (generated.failed > 0) {
    yield* Effect.log(`planned: ${generated.failed} schedules failed`);
  }

  const swept = yield* sweepRateLimits();
  const cutoff = (yield* now).getTime() - 24 * 60 * 60 * 1000;
  const sweptAuth = yield* query((db) =>
    db
      .delete(authRateLimits)
      .where(lt(authRateLimits.lastRequest, cutoff))
      .returning({ id: authRateLimits.id }),
  );
  yield* Effect.log(
    `rate limits: swept ${swept} app and ${sweptAuth.length} auth windows`,
  );

  // the sweep above still ran; failing now turns the cron answer into a 500
  if (generated.failed > 0) {
    return yield* Effect.fail(
      new Error(`${generated.failed} planned schedules failed to generate`),
    );
  }
});
