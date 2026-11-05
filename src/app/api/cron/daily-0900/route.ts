import { cronHandler } from "~/server/cron";
import { dailyMorning } from "~/server/jobs/daily-0900";

export const dynamic = "force-dynamic";

export const GET = cronHandler("daily-0900", dailyMorning());
