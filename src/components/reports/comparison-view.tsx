"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChartPieIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
import { Fragment, type ReactNode, useMemo, useState } from "react";

import { Money } from "~/components/app/money";
import { PageHeader } from "~/components/app/page-header";
import { DeltaCell } from "~/components/reports/delta-cell";
import { PeriodPicker } from "~/components/reports/period-picker";
import { FilterButton } from "~/components/transactions/filter-bar";
import { useToday } from "~/components/transactions/transaction-groups";
import {
  isIsoDate,
  useTransactionFilter,
} from "~/components/transactions/use-filter";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { defaultPeriods, type Period } from "~/lib/period";
import {
  buildComparison,
  type ComparisonPair,
  type ComparisonRow,
  type ComparisonSection,
  type ComparisonTable,
} from "~/lib/report";
import { cn } from "~/lib/utils";
import { useTRPC } from "~/trpc/react";

const periodParsers = {
  aStart: parseAsString,
  aEnd: parseAsString,
  bStart: parseAsString,
  bEnd: parseAsString,
};

const periodOr = (
  startDate: string | null,
  endDate: string | null,
  fallback: Period,
): Period =>
  isIsoDate(startDate) && isIsoDate(endDate) && startDate <= endDate
    ? { startDate, endDate }
    : fallback;

/**
 * Wide (the card's `@container` at 4xl and up), the name, A, B and the
 * difference share a row. Narrow, the name column is hidden and the name gets
 * a row of its own above the numbers, so the table never scrolls sideways.
 */
const WIDE_ONLY = "@max-4xl:hidden";

function Amount({ value, sign }: { value: number; sign: string }) {
  return (
    <TableCell className="@max-4xl:pl-0 text-right">
      {value === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <Money amount={value} sign={sign} />
      )}
    </TableCell>
  );
}

function Line({
  name,
  pair,
  sign,
  scale,
  goodWhen,
  className,
}: {
  name: ReactNode;
  pair: ComparisonPair;
  sign: string;
  scale: number;
  goodWhen: "up" | "down";
  className?: string;
}) {
  return (
    <>
      <TableRow
        className={cn("@4xl:hidden border-0 hover:bg-transparent", className)}
      >
        <TableCell colSpan={3} className="max-w-0 pb-0 [font-weight:inherit]">
          {name}
        </TableCell>
      </TableRow>
      <TableRow className={cn("@max-4xl:[&>td]:pt-1", className)}>
        <TableHead
          scope="row"
          className={cn("max-w-0 [font-weight:inherit]", WIDE_ONLY)}
        >
          {name}
        </TableHead>
        <Amount value={pair.a} sign={sign} />
        <Amount value={pair.b} sign={sign} />
        <TableCell className="@max-4xl:pl-0">
          <DeltaCell
            pair={pair}
            sign={sign}
            scale={scale}
            goodWhen={goodWhen}
          />
        </TableCell>
      </TableRow>
    </>
  );
}

/** The largest |B − A| of any line in a table, which every bar is scaled to */
const scaleOf = (table: ComparisonTable) => {
  const pairs: ComparisonPair[] = [table.remainder];

  for (const section of [table.income, table.expense]) {
    pairs.push(section.total);

    for (const row of section.rows) {
      pairs.push(row, ...row.children);
    }
  }

  return Math.max(...pairs.map((pair) => Math.abs(pair.b - pair.a)));
};

function Section({
  title,
  section,
  sign,
  scale,
  goodWhen,
  expanded,
  toggle,
}: {
  title: string;
  section: ComparisonSection;
  sign: string;
  scale: number;
  goodWhen: "up" | "down";
  expanded: (row: ComparisonRow) => boolean;
  toggle: (row: ComparisonRow) => void;
}) {
  const t = useTranslations("reports");

  return (
    <>
      <Line
        name={title}
        pair={section.total}
        sign={sign}
        scale={scale}
        goodWhen={goodWhen}
        className="bg-muted/50 font-medium hover:bg-muted/50"
      />
      {section.rows.map((row) => {
        const open = expanded(row);

        return (
          <Fragment key={row.key}>
            <Line
              name={
                <span className="flex min-w-0 items-center gap-1">
                  {row.children.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-expanded={open}
                      aria-label={open ? t("collapse") : t("expand")}
                      onClick={() => toggle(row)}
                    >
                      <ChevronRightIcon
                        className={cn(
                          "transition-transform",
                          open && "rotate-90",
                        )}
                      />
                    </Button>
                  ) : (
                    <span className="size-6 shrink-0" />
                  )}
                  <span className="truncate" title={row.name}>
                    {row.name}
                  </span>
                </span>
              }
              pair={row}
              sign={sign}
              scale={scale}
              goodWhen={goodWhen}
            />
            {open
              ? row.children.map((child) => (
                  <Line
                    key={child.key}
                    name={
                      <span className="block truncate pl-7 text-muted-foreground">
                        {child.name}
                      </span>
                    }
                    pair={child}
                    sign={sign}
                    scale={scale}
                    goodWhen={goodWhen}
                  />
                ))
              : null}
          </Fragment>
        );
      })}
    </>
  );
}

export function ComparisonView() {
  const t = useTranslations("reports");
  const tt = useTranslations("transactions");
  const trpc = useTRPC();
  const today = useToday();
  const { state, setState, filter, reset } = useTransactionFilter();
  const [periods, setPeriods] = useQueryStates(periodParsers, {
    history: "replace",
  });
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const [a, b] = useMemo((): [Period, Period] => {
    const [fallbackA, fallbackB] = defaultPeriods(today);

    return [
      periodOr(periods.aStart, periods.aEnd, fallbackA),
      periodOr(periods.bStart, periods.bEnd, fallbackB),
    ];
  }, [periods, today]);

  // the periods replace the filter's own dates
  const data = useQuery({
    ...trpc.reports.compare.queryOptions({
      filter: { ...filter, startDate: null, endDate: null },
      periods: [a, b],
    }),
    placeholderData: keepPreviousData,
  });

  const tables = useMemo(
    () =>
      buildComparison(data.data?.a ?? [], data.data?.b ?? [], {
        noCategory: tt("noCategory"),
        debts: t("debts"),
      }),
    [data.data, t, tt],
  );

  const toggle = (key: string) =>
    setExpandedKeys((keys) => {
      const next = new Set(keys);

      if (!next.delete(key)) {
        next.add(key);
      }

      return next;
    });

  return (
    <>
      <PageHeader
        title={
          <>
            {t("title")}{" "}
            <span className="text-muted-foreground">/ {t("comparison")}</span>
          </>
        }
        actions={
          <FilterButton
            state={state}
            setState={setState}
            reset={reset}
            withDates={false}
          />
        }
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <Card className="py-2">
          <CardContent className="@container px-2 sm:px-4">
            <Table aria-label={t("comparison")} className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={WIDE_ONLY} />
                  <TableHead className="h-auto @4xl:w-56 @max-4xl:w-[30%] py-2 @max-4xl:pl-0 font-normal">
                    <PeriodPicker
                      label={t("period1")}
                      value={a}
                      onChange={(period) =>
                        void setPeriods({
                          aStart: period.startDate,
                          aEnd: period.endDate,
                        })
                      }
                    />
                  </TableHead>
                  <TableHead className="h-auto @4xl:w-56 @max-4xl:w-[30%] py-2 @max-4xl:pl-0 font-normal">
                    <PeriodPicker
                      label={t("period2")}
                      value={b}
                      onChange={(period) =>
                        void setPeriods({
                          bStart: period.startDate,
                          bEnd: period.endDate,
                        })
                      }
                    />
                  </TableHead>
                  <TableHead className="@4xl:w-64 text-right font-normal text-muted-foreground">
                    {t("difference")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              {tables.map((table) => {
                const scale = scaleOf(table);
                const sign = table.currencySign;
                const keyOf = (section: string, row: ComparisonRow) =>
                  `${table.currencyCode}:${section}:${row.key}`;
                const sectionProps = (section: "income" | "expense") =>
                  ({
                    section: table[section],
                    sign,
                    scale,
                    goodWhen: section === "income" ? "up" : "down",
                    expanded: (row: ComparisonRow) =>
                      expandedKeys.has(keyOf(section, row)),
                    toggle: (row: ComparisonRow) => toggle(keyOf(section, row)),
                  }) as const;

                return (
                  <TableBody key={table.currencyCode}>
                    {tables.length > 1
                      ? // a colSpan wider than the visible columns would add a
                        // phantom one, so the narrow layout has its own row
                        [
                          [4, "@max-4xl:hidden"],
                          [3, "@4xl:hidden"],
                        ].map(([span, visibility]) => (
                          <TableRow
                            key={span}
                            className={cn(
                              "border-0 hover:bg-transparent",
                              visibility,
                            )}
                          >
                            <TableHead
                              colSpan={Number(span)}
                              className="h-auto pt-4 pb-1 font-semibold text-muted-foreground text-xs"
                            >
                              {table.currencyCode}
                            </TableHead>
                          </TableRow>
                        ))
                      : null}
                    <Section title={t("income")} {...sectionProps("income")} />
                    <Section
                      title={t("expense")}
                      {...sectionProps("expense")}
                    />
                    <Line
                      name={t("remainder")}
                      pair={table.remainder}
                      sign={sign}
                      scale={scale}
                      goodWhen="up"
                      className="font-semibold"
                    />
                  </TableBody>
                );
              })}
            </Table>
            {data.isPending ? (
              <Skeleton className="my-2 h-72 w-full" />
            ) : tables.length === 0 ? (
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ChartPieIcon />
                  </EmptyMedia>
                  <EmptyDescription>{t("empty")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
