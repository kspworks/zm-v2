"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { Money } from "~/components/app/money";
import { useEntryLabel } from "~/components/dashboard/use-entry-label";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "~/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { useEdgeFade } from "~/hooks/use-edge-fade";
import type { Locale } from "~/i18n/config";
import { formatListDate, relativeDay } from "~/lib/dates";
import { filteredHref } from "~/lib/transaction-links";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/types";

type Day = RouterOutputs["dashboard"]["nearest"][number];
type Item = Day["items"][number];

const useRelativeLabel = (today: string) => {
  const t = useTranslations("transactions.relative");
  const locale = useLocale() as Locale;

  return (date: string) => {
    const relative = relativeDay(date, today, { planned: true, locale });

    return relative.kind === "weekday"
      ? relative.weekday
      : relative.kind === "inDays" || relative.kind === "daysAgo"
        ? t(relative.kind, { days: relative.days })
        : t(relative.kind);
  };
};

function ItemLine({ item, today }: { item: Item; today: string }) {
  const t = useTranslations("dashboard.balance");
  const locale = useLocale() as Locale;
  const label = useEntryLabel();

  return (
    <Link
      // overdue rows are waiting at the top of the transactions list
      href={
        item.overdue
          ? "/transactions"
          : filteredHref("/planned", {
              startDate: item.date,
              endDate: item.date,
            })
      }
      className="hover:bg-accent/50 focus-visible:ring-ring touch:min-h-11 -mx-1 flex items-baseline justify-between gap-2 rounded-md px-1 text-sm transition-colors outline-none focus-visible:ring-2"
    >
      <span className="flex min-w-0 flex-col">
        {item.comment ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate">{label(item)}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm whitespace-pre-wrap">
              {item.comment}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="truncate">{label(item)}</span>
        )}
        {item.overdue ? (
          // it sits under today, so say which day it was planned for
          <span className="text-destructive text-xs">
            {t("overdueSince", {
              date: formatListDate(item.dueDate, today, locale),
            })}
          </span>
        ) : null}
      </span>
      <Money
        amount={item.net}
        sign={item.currencySign}
        hideSign={item.unsigned}
        colored={!item.unsigned}
        className="shrink-0"
      />
    </Link>
  );
}

/** Minimum width of a date column; more columns than fit scroll sideways */
const COLUMN_REM = 13;

/** Room between columns: the first and last keep flush with the card */
const gap = "px-4 first:pl-0 last:pr-0";

/**
 * Planned transactions on the nearest dates that have any: a date per column
 * on wide screens, a list grouped by date on phones.
 */
export function NearestPlanned({
  days,
  today,
}: {
  days: Day[];
  today: string;
}) {
  const locale = useLocale() as Locale;
  const relative = useRelativeLabel(today);
  const rowCount = Math.max(...days.map((day) => day.items.length));
  const fade = useEdgeFade();

  return (
    <>
      <div
        ref={fade.ref}
        className="hidden overflow-x-auto md:block"
        style={fade.style}
      >
        <table
          className="table-fixed caption-bottom text-sm"
          style={{ width: `max(100%, ${days.length * COLUMN_REM}rem)` }}
        >
          <thead>
            <TableRow className="border-0 hover:bg-transparent">
              {days.map((day) => (
                <TableHead key={day.date} className={cn(gap, "h-auto py-0")}>
                  <div className="border-b pb-2">
                    <div>{formatListDate(day.date, today, locale)}</div>
                    <div className="text-muted-foreground text-xs font-normal first-letter:uppercase">
                      {relative(day.date)}
                    </div>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </thead>
          <TableBody>
            {Array.from({ length: rowCount }, (_, i) => (
              // rows are positions within each date's list
              // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
              <TableRow key={i} className="border-0 hover:bg-transparent">
                {days.map((day) => {
                  const item = day.items[i];

                  return (
                    <TableCell
                      key={day.date}
                      className={cn(gap, "py-0 align-top")}
                    >
                      {item ? (
                        // per-column dividers, so the gaps between columns show
                        <div className="border-b py-2">
                          <ItemLine item={item} today={today} />
                        </div>
                      ) : null}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>

      <div className="flex flex-col gap-4 md:hidden">
        {days.map((day) => (
          <section key={day.date} className="flex flex-col">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">
                {formatListDate(day.date, today, locale)}
              </span>
              <span className="text-muted-foreground text-xs first-letter:uppercase">
                {relative(day.date)}
              </span>
            </div>
            {day.items.map((item) => (
              <ItemLine key={item.id} item={item} today={today} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
