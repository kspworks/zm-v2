import { cronHandler } from "~/server/cron";
import { db } from "~/server/db";
import { dailyMorning } from "~/server/jobs/daily-0900";

export const dynamic = "force-dynamic";

export const GET = cronHandler("daily-0900", (log) => dailyMorning(db, log));
