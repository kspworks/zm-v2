import { TZDate } from "@date-fns/tz";
import {
  type Locale as DateFnsLocale,
  differenceInCalendarDays,
  format,
  parseISO,
} from "date-fns";
import { enGB, uk } from "date-fns/locale";

import type { Locale } from "~/i18n/config";

export const dateFnsLocale = (locale: Locale): DateFnsLocale =>
  locale === "en" ? enGB : uk;

/** "dd.MM.yyyy" */
export const formatDisplayDate = (date: string): string =>
  format(parseISO(date), "dd.MM.yyyy");

/** "yyyy-MM-dd" of an instant in a time zone */
export const calendarDateIn = (instant: Date, timeZone: string): string =>
  format(new TZDate(instant, timeZone), "yyyy-MM-dd");

/** List heading: "d MMMM", plus "yyyy" when not the current year */
export const formatListDate = (
  date: string,
  todayDate: string,
  locale: Locale,
): string => {
  const sameYear = date.slice(0, 4) === todayDate.slice(0, 4);

  return format(parseISO(date), sameYear ? "d MMMM" : "d MMMM yyyy", {
    locale: dateFnsLocale(locale),
  });
};

export type RelativeDay =
  | { kind: "today" | "yesterday" | "tomorrow" }
  | { kind: "weekday"; weekday: string }
  | { kind: "inDays" | "daysAgo"; days: number };

/**
 * The relative label next to a list date: today/yesterday/tomorrow within a
 * day, otherwise the weekday name (submitted rows) or "in N days" / "N days
 * ago" (planned rows).
 */
export const relativeDay = (
  date: string,
  todayDate: string,
  { planned, locale }: { planned: boolean; locale: Locale },
): RelativeDay => {
  const diff = differenceInCalendarDays(parseISO(date), parseISO(todayDate));

  if (diff === 0) {
    return { kind: "today" };
  }

  if (diff === -1) {
    return { kind: "yesterday" };
  }

  if (diff === 1) {
    return { kind: "tomorrow" };
  }

  if (!planned) {
    return {
      kind: "weekday",
      weekday: format(parseISO(date), "EEEE", {
        locale: dateFnsLocale(locale),
      }),
    };
  }

  return diff > 0
    ? { kind: "inDays", days: diff }
    : { kind: "daysAgo", days: -diff };
};
