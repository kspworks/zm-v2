import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

import { calendarDateIn } from "~/lib/dates";

export type CronJob = {
  path: string;
  /** "HH:mm" wall-clock time in APP_TIMEZONE */
  at: string;
};

/** The cron routes and when they run - see README "Cron jobs" */
export const CRON_JOBS: readonly CronJob[] = [
  { path: "/api/cron/daily-0000", at: "00:00" },
  { path: "/api/cron/daily-0900", at: "09:00" },
];

/**
 * Jobs scheduled for the wall-clock minute `instant` falls in, in `timeZone`,
 * that have not run on that local day yet (`lastRun` maps a path to the
 * "yyyy-MM-dd" it last ran on).
 *
 * Only the exact minute counts, never a later one: a container (re)started at
 * 10:00 must not send the 09:00 emails a second time. The day check covers a
 * minute seen twice, by two ticks or by a clock turned back an hour.
 */
export const dueJobs = (
  instant: Date,
  timeZone: string,
  lastRun: ReadonlyMap<string, string>,
  jobs: readonly CronJob[] = CRON_JOBS,
): CronJob[] => {
  const time = format(new TZDate(instant, timeZone), "HH:mm");
  const day = calendarDateIn(instant, timeZone);

  return jobs.filter((job) => job.at === time && lastRun.get(job.path) !== day);
};
