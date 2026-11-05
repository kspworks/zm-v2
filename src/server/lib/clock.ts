import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { Clock, Effect } from "effect";

import { appTimezone } from "~/server/config";
import { AppConfig } from "~/server/effect/app-config";

/**
 * The single source of "now" for Effect code: Effect's `Clock`. Its live
 * implementation reads `Date.now()`, so tests that fake `Date` with
 * vi.useFakeTimers({ toFake: ["Date"] }) still control it; Effect-native
 * tests can use `TestClock` instead.
 */
export const now: Effect.Effect<Date> = Effect.map(
  Clock.currentTimeMillis,
  (millis) => new Date(millis),
);

/** "yyyy-MM-dd" of the given instant in APP_TIMEZONE */
export const calendarDateAt = (instant: Date, tz = appTimezone()): string =>
  format(new TZDate(instant, tz), "yyyy-MM-dd");

/** Today in APP_TIMEZONE, as "yyyy-MM-dd" */
export const today: Effect.Effect<string, never, AppConfig> = Effect.gen(
  function* () {
    const { timezone } = yield* AppConfig;

    return calendarDateAt(yield* now, timezone);
  },
);

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
