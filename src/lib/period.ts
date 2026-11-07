import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from "date-fns";

/** An inclusive range of "yyyy-MM-dd" calendar dates */
export type Period = { startDate: string; endDate: string };

const iso = (date: Date) => format(date, "yyyy-MM-dd");

/** The calendar month that holds `date` */
export const monthOf = (date: string): Period => ({
  startDate: iso(startOfMonth(parseISO(date))),
  endDate: iso(endOfMonth(parseISO(date))),
});

export const isWholeMonth = (period: Period): boolean => {
  const month = monthOf(period.startDate);

  return (
    month.startDate === period.startDate && month.endDate === period.endDate
  );
};

/**
 * The next (`step` 1) or previous (-1) period: a whole month moves by a
 * month, any other range by its own length in days.
 */
export const shiftPeriod = (period: Period, step: 1 | -1): Period => {
  if (isWholeMonth(period)) {
    return monthOf(iso(addMonths(parseISO(period.startDate), step)));
  }

  const days =
    (differenceInCalendarDays(
      parseISO(period.endDate),
      parseISO(period.startDate),
    ) +
      1) *
    step;

  return {
    startDate: iso(addDays(parseISO(period.startDate), days)),
    endDate: iso(addDays(parseISO(period.endDate), days)),
  };
};

/**
 * Both periods cut to the days of the running one that have passed, so a month
 * in progress is measured against the same days of the other instead of all
 * of it. Null when neither is still running.
 */
export const sameDays = (
  [a, b]: [Period, Period],
  today: string,
): { periods: [Period, Period]; days: number } | null => {
  const running = [b, a].find(
    (period) => period.startDate <= today && today < period.endDate,
  );

  if (!running) {
    return null;
  }

  const days =
    differenceInCalendarDays(parseISO(today), parseISO(running.startDate)) + 1;
  const cut = (period: Period): Period => {
    const end = iso(addDays(parseISO(period.startDate), days - 1));

    return end < period.endDate
      ? { startDate: period.startDate, endDate: end }
      : period;
  };

  return { periods: [cut(a), cut(b)], days };
};

/** Last month vs this month */
export const defaultPeriods = (today: string): [Period, Period] => {
  const current = monthOf(today);

  return [shiftPeriod(current, -1), current];
};
