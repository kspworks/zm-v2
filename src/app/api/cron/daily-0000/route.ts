import { cronHandler } from "~/server/cron";
import { runServer } from "~/server/effect/runtime";
import { dailyMidnight } from "~/server/jobs/daily-0000";

export const dynamic = "force-dynamic";

export const GET = cronHandler("daily-0000", (log) =>
  runServer(dailyMidnight(log)),
);
