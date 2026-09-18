import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";

import { appTimezone } from "~/server/config";

/**
 * The single source of "now" for the server. Tests fake `Date` with
 * vi.useFakeTimers({ toFake: ["Date"] }), which this picks up.
 */
export const now = (): Date => new Date();

/** "yyyy-MM-dd" of the given instant in APP_TIMEZONE */
export const calendarDateAt = (instant: Date, tz = appTimezone()): string =>
  format(new TZDate(instant, tz), "yyyy-MM-dd");

/** Today in APP_TIMEZONE, as "yyyy-MM-dd" */
export const today = (tz = appTimezone()): string => calendarDateAt(now(), tz);

/** Tomorrow in APP_TIMEZONE, as "yyyy-MM-dd" */
export const tomorrow = (tz = appTimezone()): string =>
  format(addDays(new TZDate(now(), tz), 1), "yyyy-MM-dd");

/** Parses "yyyy-MM-dd HH:mm:ss" as a wall-clock time in APP_TIMEZONE */
export const parseLocalDateTime = (value: string, tz = appTimezone()): Date => {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      value.trim(),
    );

  if (!match) {
    throw new TypeError(`Invalid local date-time: ${value}`);
  }

  const [, y, mo, d, h, mi, s] = match.map(Number) as number[];

  return new Date(
    new TZDate(
      y ?? 0,
      (mo ?? 1) - 1,
      d ?? 1,
      h ?? 0,
      mi ?? 0,
      s ?? 0,
      tz,
    ).getTime(),
  );
};
