import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  format,
  parseISO,
  startOfISOWeek,
} from "date-fns";

export const REPEAT_TYPES = ["daily", "weekly", "monthly", "yearly"] as const;

export type RepeatType = (typeof REPEAT_TYPES)[number];

export type ScheduleRule = {
  startDate: string;
  endDate: string | null;
  repeatType: RepeatType;
  repeatInterval: number;
  repeatWeekdays: number[];
};

const iso = (date: Date) => format(date, "yyyy-MM-dd");

/** min(endDate, today + 1 year) */
export const scheduleHorizon = (rule: ScheduleRule, today: string): string => {
  const yearAhead = iso(addYears(parseISO(today), 1));

  return rule.endDate && rule.endDate < yearAhead ? rule.endDate : yearAhead;
};

/**
 * Every occurrence date of a schedule from its start up to the horizon.
 *
 * Step k lands on start + k × interval units. Months and years are computed
 * from the start rather than from the previous step, so a schedule on the
 * 31st keeps returning to month ends instead of drifting to the 28th after
 * February. For weekly schedules each step emits every selected weekday of
 * the Monday-started week containing it, kept only within [start, horizon].
 */
export const occurrenceDates = (
  rule: ScheduleRule,
  today: string,
): string[] => {
  const start = parseISO(rule.startDate);
  const horizon = scheduleHorizon(rule, today);
  const interval = Math.max(1, rule.repeatInterval);
  const dates = new Set<string>();

  const step = (k: number): Date => {
    switch (rule.repeatType) {
      case "daily":
        return addDays(start, k * interval);
      case "weekly":
        return addWeeks(start, k * interval);
      case "monthly":
        return addMonths(start, k * interval);
      case "yearly":
        return addYears(start, k * interval);
    }
  };

  const weekdays = [...new Set(rule.repeatWeekdays)]
    .filter((day) => day >= 1 && day <= 7)
    .sort((a, b) => a - b);

  for (let k = 0; ; k++) {
    const d = step(k);
    const day = iso(d);

    if (rule.repeatType !== "weekly") {
      if (day > horizon) {
        break;
      }

      dates.add(day);
      continue;
    }

    // a week is still due while its Monday is: the step date itself may be
    // past the horizon while earlier weekdays of the same week are not
    const monday = startOfISOWeek(d);

    if (iso(monday) > horizon) {
      break;
    }

    for (const weekday of weekdays) {
      const candidate = iso(addDays(monday, weekday - 1));

      if (candidate >= rule.startDate && candidate <= horizon) {
        dates.add(candidate);
      }
    }
  }

  return [...dates].sort();
};
