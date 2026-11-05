import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";

import { appTimezone } from "~/server/config";

/**
 * Synchronous clock for code not yet migrated to Effect. Effect code reads
 * time through `now` / `today` / `tomorrow` in `~/server/lib/clock`.
 */
export const now = (): Date => new Date();

export const tomorrow = (tz = appTimezone()): string =>
  format(addDays(new TZDate(now(), tz), 1), "yyyy-MM-dd");
