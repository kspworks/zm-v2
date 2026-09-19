"use client";

import { format, parseISO } from "date-fns";
import { useLocale, useTranslations } from "next-intl";

import { Money } from "~/components/app/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import type { Locale } from "~/i18n/config";
import type { ForecastMonth } from "~/lib/dashboard";
import { dateFnsLocale } from "~/lib/dates";
import { cn } from "~/lib/utils";

const sticky = "sticky left-0 z-10 bg-card";

/** Income, expense and month-end balance: this month and the next eight */
export function ForecastTable({
  months,
  today,
}: {
  months: ForecastMonth[];
  today: string;
}) {
  const t = useTranslations("dashboard.forecast");
  const locale = useLocale() as Locale;
  const current = today.slice(0, 7);
  const year = today.slice(0, 4);

  const rows = [
    {
      key: "income",
      value: (m: ForecastMonth) => m.income,
      className: () => "text-emerald-600 dark:text-emerald-400",
    },
    {
      key: "expense",
      value: (m: ForecastMonth) => m.expense,
      className: () => "",
    },
    {
      key: "balance",
      value: (m: ForecastMonth) => m.balance,
      className: (m: ForecastMonth) =>
        cn("font-semibold", m.balance < 0 && "text-destructive"),
    },
  ] as const;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className={sticky} />
          {months.map((m) => (
            <TableHead
              key={m.month}
              className={cn(
                "h-auto py-2 text-right align-bottom",
                m.month === current && "bg-muted/50",
              )}
            >
              <div className="first-letter:uppercase">
                {format(parseISO(`${m.month}-01`), "LLLL", {
                  locale: dateFnsLocale(locale),
                })}
              </div>
              {m.month.slice(0, 4) !== year ? (
                <div className="font-normal text-muted-foreground text-xs">
                  {m.month.slice(0, 4)}
                </div>
              ) : null}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key} className="hover:bg-transparent">
            <TableCell className={cn(sticky, "font-medium")}>
              {t(row.key)}
            </TableCell>
            {months.map((m) => (
              <TableCell
                key={m.month}
                className={cn(
                  "text-right",
                  m.month === current && "bg-muted/50",
                  row.value(m) !== 0 && row.className(m),
                  row.value(m) === 0 &&
                    row.key !== "balance" &&
                    "text-muted-foreground",
                )}
              >
                <Money amount={row.value(m)} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
