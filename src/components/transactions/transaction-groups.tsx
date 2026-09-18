"use client";

import { useLocale, useNow, useTimeZone, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  TransactionItem,
  type TransactionRowData,
} from "~/components/transactions/transaction-item";
import type { Locale } from "~/i18n/config";
import { calendarDateIn, formatListDate, relativeDay } from "~/lib/dates";

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
    <div className="flex items-baseline gap-2 px-3 pt-4 pb-1.5 sm:px-4">
      <span className="font-semibold text-sm">
        {formatListDate(date, today, locale)}
      </span>
      <span className="text-muted-foreground text-xs first-letter:uppercase">
        {label}
      </span>
    </div>
  );
}

/** Rows grouped by day, the date shown once per group */
export function TransactionGroups({
  rows,
  planned,
  actions,
}: {
  rows: TransactionRowData[];
  planned: boolean;
  actions: (row: TransactionRowData) => ReactNode;
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
    <div className="flex flex-col">
      {groups.map((group) => (
        <section key={group.date}>
          <DayHeading date={group.date} planned={planned} />
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {group.rows.map((row) => (
              <TransactionItem key={row.id} row={row} actions={actions(row)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
