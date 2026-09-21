"use client";

import { useQuery } from "@tanstack/react-query";
import { format, subMonths } from "date-fns";
import { AlertTriangleIcon, ChartPieIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { Money } from "~/components/app/money";
import { PageHeader } from "~/components/app/page-header";
import { ReportTreemap } from "~/components/reports/report-treemap";
import { FilterButton } from "~/components/transactions/filter-bar";
import { useToday } from "~/components/transactions/transaction-groups";
import { useTransactionFilter } from "~/components/transactions/use-filter";
import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
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
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { formatMoney } from "~/lib/money";
import { buildReport, colorSlots } from "~/lib/report";
import { useTRPC } from "~/trpc/react";

const SLOTS = 8;

export function ReportsView() {
  const t = useTranslations("reports");
  const tt = useTranslations("transactions");
  const trpc = useTRPC();
  const today = useToday();
  const { state, setState, filter, reset } = useTransactionFilter();
  const [view, setView] = useState<"expense" | "income">("expense");

  // the range is required: default to one month ago .. today
  useEffect(() => {
    if (!state.startDate || !state.endDate) {
      void setState({
        startDate:
          state.startDate ??
          format(subMonths(new Date(`${today}T12:00:00`), 1), "yyyy-MM-dd"),
        endDate: state.endDate ?? today,
      });
    }
  }, [state.startDate, state.endDate, today, setState]);

  const range =
    filter.startDate && filter.endDate
      ? { ...filter, startDate: filter.startDate, endDate: filter.endDate }
      : null;

  const data = useQuery({
    ...trpc.reports.data.queryOptions({
      filter: range ?? { ...filter, startDate: today, endDate: today },
    }),
    enabled: range !== null,
  });

  const charts = useMemo(
    () =>
      buildReport(data.data?.rows ?? [], view, {
        noCategory: tt("noCategory"),
      }),
    [data.data, view, tt],
  );

  // slots go to the largest tiles in the view, so the blocks that dominate
  // the chart get distinct hues; the tail and "no category" are gray. Tiles
  // carry a name label, so identity never depends on color alone
  const colorOf = useMemo(() => {
    const slots = colorSlots(charts, SLOTS);

    return (key: string) => {
      const slot = slots.get(key);

      return slot ? `var(--series-${slot})` : "var(--series-other)";
    };
  }, [charts]);

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <FilterButton
            state={state}
            setState={setState}
            reset={reset}
            requireDates
          />
        }
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <Tabs
          value={view}
          onValueChange={(value) => setView(value as typeof view)}
        >
          <TabsList>
            <TabsTrigger value="expense">{t("expense")}</TabsTrigger>
            <TabsTrigger value="income">{t("income")}</TabsTrigger>
          </TabsList>
        </Tabs>

        {data.data?.truncated ? (
          <Alert>
            <AlertTriangleIcon />
            <AlertDescription>
              {t("truncated", { limit: "100 000" })}
            </AlertDescription>
          </Alert>
        ) : null}

        {data.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : charts.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChartPieIcon />
              </EmptyMedia>
              <EmptyDescription>{t("empty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          charts.map((chart) => (
            <Card key={chart.currencyCode}>
              <CardHeader>
                {charts.length > 1 ? (
                  <CardDescription>{chart.currencyCode}</CardDescription>
                ) : null}
                <CardTitle className="text-lg">
                  {t("total", {
                    amount: formatMoney(chart.total, chart.currencySign),
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ReportTreemap chart={chart} colorOf={colorOf} />
                <Collapsible>
                  <CollapsibleTrigger className="text-muted-foreground text-sm underline-offset-4 hover:underline">
                    {t("table")}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Table className="mt-2">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("category")}</TableHead>
                          <TableHead className="text-right">
                            {t("amount")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("share")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {chart.tiles.map((tile) => (
                          <TableRow key={tile.key}>
                            <TableCell>
                              <span className="flex items-center gap-2">
                                <span
                                  className="size-2.5 shrink-0 rounded-sm"
                                  style={{ background: colorOf(tile.key) }}
                                />
                                {tile.name}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Money
                                amount={tile.value}
                                sign={chart.currencySign}
                              />
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground tabular-nums">
                              {((tile.value / chart.total) * 100).toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
