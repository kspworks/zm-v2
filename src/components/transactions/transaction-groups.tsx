"use client";

import { useLocale, useNow, useTimeZone, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  TransactionItem,
  type TransactionRowData,
} from "~/components/transactions/transaction-item";
import type { Locale } from "~/i18n/config";
import { calendarDateIn, formatListDate, relativeDay } from "~/lib/dates";
import { cn } from "~/lib/utils";

/** Today in the app time zone, as "yyyy-MM-dd" */
export const useToday = () => {
  const timeZone = useTimeZone() ?? "Europe/Kyiv";
  const now = useNow({ updateInterval: 60_000 });

  return calendarDateIn(now, timeZone);
};

export function DayHeading({
  date,
  planned,
}: {
  date: string;
  planned: boolean;
}) {
  const t = useTranslations("transactions.relative");
  const locale = useLocale() as Locale;
  const today = useToday();
  const relative = relativeDay(date, today, { planned, locale });

  const label =
    relative.kind === "weekday"
      ? relative.weekday
      : relative.kind === "inDays" || relative.kind === "daysAgo"
        ? t(relative.kind, { days: relative.days })
        : t(relative.kind);

  return (
    // above the rows in a narrow list, a column beside them in a wide one
    <div className="flex items-baseline gap-2 @max-2xl:px-3 @max-2xl:pt-4 @max-2xl:pb-1.5 @max-2xl:sm:px-4 @max-2xl:md:pt-2.5 @max-2xl:md:pb-1 @2xl:flex-col @2xl:gap-0 @2xl:pt-1.5 @2xl:pl-1">
      <span className="text-sm font-semibold">
        {formatListDate(date, today, locale)}
      </span>
      <span
        className={cn(
          "text-xs first-letter:uppercase",
          // a planned day that has passed is overdue
          planned && date < today
            ? "text-amber-700 dark:text-amber-400"
            : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Rows grouped by day, the date shown once per group. In a wide list the
 * date sits in a column on the left, so a day with one row takes one line
 * instead of two.
 */
export function TransactionGroups({
  rows,
  planned,
  actions,
  onOpen,
}: {
  rows: TransactionRowData[];
  planned: boolean;
  actions: (row: TransactionRowData) => ReactNode;
  onOpen: (row: TransactionRowData) => void;
}) {
  const groups: { date: string; rows: TransactionRowData[] }[] = [];

  for (const row of rows) {
    const last = groups.at(-1);

    if (last?.date === row.date) {
      last.rows.push(row);
    } else {
      groups.push({ date: row.date, rows: [row] });
    }
  }

  return (
    <div className="@container flex flex-col @2xl:gap-1.5">
      {groups.map((group) => (
        <section
          key={group.date}
          className="@2xl:grid @2xl:grid-cols-[8.5rem_minmax(0,1fr)] @2xl:items-start @2xl:gap-x-3"
        >
          <DayHeading date={group.date} planned={planned} />
          <div className="bg-card divide-y overflow-hidden rounded-lg border">
            {group.rows.map((row) => (
              <TransactionItem
                key={row.id}
                row={row}
                actions={actions(row)}
                onOpen={() => onOpen(row)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
