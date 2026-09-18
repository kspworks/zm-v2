import type { Locale } from "~/i18n/config";
import { formatDisplayDate } from "~/lib/dates";

export type ScheduleShape = {
  repeatType: "daily" | "weekly" | "monthly" | "yearly";
  repeatInterval: number;
  repeatWeekdays: number[];
  endDate: string | null;
};

type Unit = ScheduleShape["repeatType"];

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & {
  other: string;
};

const WORDS: Record<
  Locale,
  {
    repeats: string;
    every1: Record<Unit, string>;
    everyN: (n: number, unit: string) => string;
    units: Record<Unit, PluralForms>;
    on: string;
    until: string;
    weekdays: string[];
    list: string;
  }
> = {
  en: {
    repeats: "Repeats",
    every1: {
      daily: "every day",
      weekly: "every week",
      monthly: "every month",
      yearly: "every year",
    },
    everyN: (n, unit) => `every ${n} ${unit}`,
    units: {
      daily: { one: "day", other: "days" },
      weekly: { one: "week", other: "weeks" },
      monthly: { one: "month", other: "months" },
      yearly: { one: "year", other: "years" },
    },
    on: "on",
    until: "until",
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    list: "en-GB",
  },
  uk: {
    repeats: "Повторюється",
    every1: {
      daily: "щодня",
      weekly: "щотижня",
      monthly: "щомісяця",
      yearly: "щороку",
    },
    everyN: (n, unit) => `кожні ${n} ${unit}`,
    units: {
      daily: { one: "день", few: "дні", many: "днів", other: "дня" },
      weekly: { one: "тиждень", few: "тижні", many: "тижнів", other: "тижня" },
      monthly: {
        one: "місяць",
        few: "місяці",
        many: "місяців",
        other: "місяця",
      },
      yearly: { one: "рік", few: "роки", many: "років", other: "року" },
    },
    on: "у",
    until: "до",
    weekdays: ["пн", "вт", "ср", "чт", "пт", "сб", "нд"],
    list: "uk",
  },
};

/**
 * Describes a schedule in words, e.g. "Repeats every 2 weeks on Mon and Thu
 * until 01.05.2027". Pure, so it renders the same on server and client.
 */
export const describeSchedule = (
  schedule: ScheduleShape,
  locale: Locale,
): string => {
  const words = WORDS[locale];
  const n = Math.max(1, schedule.repeatInterval);
  const unit = schedule.repeatType;

  const rule = new Intl.PluralRules(locale === "en" ? "en" : "uk").select(n);
  const forms = words.units[unit];
  const every =
    n === 1 ? words.every1[unit] : words.everyN(n, forms[rule] ?? forms.other);

  const parts = [words.repeats, every];

  if (unit === "weekly" && schedule.repeatWeekdays.length > 0) {
    const days = [...new Set(schedule.repeatWeekdays)]
      .filter((day) => day >= 1 && day <= 7)
      .sort((a, b) => a - b)
      .map((day) => words.weekdays[day - 1] ?? "");

    parts.push(
      words.on,
      new Intl.ListFormat(words.list, {
        style: "long",
        type: "conjunction",
      }).format(days),
    );
  }

  if (schedule.endDate) {
    parts.push(words.until, formatDisplayDate(schedule.endDate));
  }

  return parts.join(" ");
};
