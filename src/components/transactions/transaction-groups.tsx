"use client";

import { useLocale, useNow, useTimeZone, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  LedgerGroup,
  LedgerGroups,
  LedgerHeading,
} from "~/components/app/ledger-list";
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
    <LedgerHeading title={formatListDate(date, today, locale)}>
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
    </LedgerHeading>
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
    <LedgerGroups>
      {groups.map((group) => (
        <LedgerGroup
          key={group.date}
          heading={<DayHeading date={group.date} planned={planned} />}
        >
          {group.rows.map((row) => (
            <TransactionItem
              key={row.id}
              row={row}
              actions={actions(row)}
              onOpen={() => onOpen(row)}
            />
          ))}
        </LedgerGroup>
      ))}
    </LedgerGroups>
  );
}
