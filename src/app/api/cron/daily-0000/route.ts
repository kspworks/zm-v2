import { cronHandler } from "~/server/cron";
import { db } from "~/server/db";
import { dailyMidnight } from "~/server/jobs/daily-0000";

export const dynamic = "force-dynamic";

export const GET = cronHandler("daily-0000", (log) => dailyMidnight(db, log));
