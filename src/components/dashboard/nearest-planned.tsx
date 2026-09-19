"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Money } from "~/components/app/money";
import { useEntryLabel } from "~/components/dashboard/use-entry-label";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "~/components/ui/table";
import type { Locale } from "~/i18n/config";
import { formatListDate, relativeDay } from "~/lib/dates";
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

function ItemLine({ item }: { item: Item }) {
  const t = useTranslations("dashboard.balance");
  const label = useEntryLabel();

  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="flex min-w-0 flex-col">
        <span className="truncate" title={item.comment ?? undefined}>
          {label(item)}
        </span>
        {item.overdue ? (
          <span className="text-destructive text-xs">{t("overdue")}</span>
        ) : null}
      </span>
      <Money
        amount={item.net}
        sign={item.currencySign}
        hideSign={item.unsigned}
        colored={!item.unsigned}
        className="shrink-0"
      />
    </div>
  );
}

/** Minimum width of a date column; more columns than fit scroll sideways */
const COLUMN_REM = 13;

/** Room between columns: the first and last keep flush with the card */
const gap = "px-4 first:pl-0 last:pr-0";

const FADE = "3rem";

/**
 * Fades the edges of a horizontal scroller that has more content past them,
 * so it is clear there is something to scroll to.
 */
const useEdgeFade = () => {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    if (!node) {
      return;
    }

    const update = () => {
      const max = node.scrollWidth - node.clientWidth;

      setEdges({
        left: node.scrollLeft > 1,
        right: node.scrollLeft < max - 1,
      });
    };

    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);

    return () => {
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [node]);

  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "black"}, black ${FADE}, black calc(100% - ${FADE}), ${edges.right ? "transparent" : "black"})`
      : undefined;

  return {
    ref: setNode,
    style: mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined,
  };
};

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
                    <div className="font-normal text-muted-foreground text-xs first-letter:uppercase">
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
                          <ItemLine item={item} />
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

      <div className="flex flex-col gap-8 md:hidden">
        {days.map((day) => (
          <section key={day.date} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-sm">
                {formatListDate(day.date, today, locale)}
              </span>
              <span className="text-muted-foreground text-xs first-letter:uppercase">
                {relative(day.date)}
              </span>
            </div>
            {day.items.map((item) => (
              <ItemLine key={item.id} item={item} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
