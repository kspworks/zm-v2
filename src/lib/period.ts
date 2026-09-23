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

/** Last month vs this month */
export const defaultPeriods = (today: string): [Period, Period] => {
  const current = monthOf(today);

  return [shiftPeriod(current, -1), current];
};
