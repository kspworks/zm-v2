"use client";

import { useQuery } from "@tanstack/react-query";
import { format, subMonths } from "date-fns";
import { AlertTriangleIcon, ChartPieIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { z } from "zod";

import { Money } from "~/components/app/money";
import { PageHeader } from "~/components/app/page-header";
import { ReportTreemap } from "~/components/reports/report-treemap";
import { FilterButton } from "~/components/transactions/filter-bar";
import { useToday } from "~/components/transactions/transaction-groups";
import { useDebtLabelText } from "~/components/transactions/transaction-item";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "~/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
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
import { useLocalStorage } from "~/hooks/use-local-storage";
import { formatDisplayDate } from "~/lib/dates";
import { formatMoney } from "~/lib/money";
import {
  buildReport,
  colorSlots,
  type ReportGroupBy,
  type ReportInput,
  reportGroupBySchema,
} from "~/lib/report";
import { useTRPC } from "~/trpc/react";

const SLOTS = 8;

const viewSchema = z.enum(["expense", "income"]);

const GROUP_BY_LABELS = {
  category: "byCategory",
  account: "byAccount",
  counterparty: "byCounterparty",
} as const;

export function ReportsView() {
  const t = useTranslations("reports");
  const tt = useTranslations("transactions");
  const trpc = useTRPC();
  const today = useToday();
  const debtLabelText = useDebtLabelText();
  const { state, setState, filter, reset } = useTransactionFilter();
  const [view, setView] = useLocalStorage(
    "zm.reports.view",
    viewSchema,
    "expense",
  );
  const [groupBy, setGroupBy] = useLocalStorage(
    "zm.reports.groupBy",
    reportGroupBySchema,
    "category",
  );

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

  const dateRangeText = range
    ? `${formatDisplayDate(range.startDate)} – ${formatDisplayDate(range.endDate)}`
    : null;

  const data = useQuery({
    ...trpc.reports.data.queryOptions({
      filter: range ?? { ...filter, startDate: today, endDate: today },
    }),
    enabled: range !== null,
  });

  const charts = useMemo(() => {
    // same wording as the transactions list; old rows without a
    // counterparty say Gave/Took
    const debtDescription = (row: ReportInput) => {
      const name = row.counterpartyName ?? "";

      if (!row.debtLabel) {
        const direction = row.amount < 0 ? tt("gave") : tt("took");

        return name ? `${direction} · ${name}` : direction;
      }

      return debtLabelText(row.debtLabel, name, row.currencySign);
    };

    return buildReport(data.data?.rows ?? [], view, groupBy, {
      noCategory: tt("noCategory"),
      noCounterparty: t("noCounterparty"),
      debts: t("debts"),
      debtDescription,
    });
  }, [data.data, view, groupBy, t, tt, debtLabelText]);

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
        title={
          <>
            {t("title")}{" "}
            <span className="text-muted-foreground">/ {t("map")}</span>
          </>
        }
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs
            value={view}
            onValueChange={(value) => setView(viewSchema.parse(value))}
          >
            <TabsList>
              <TabsTrigger value="expense">{t("expense")}</TabsTrigger>
              <TabsTrigger value="income">{t("income")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select
            value={groupBy}
            onValueChange={(value) =>
              setGroupBy(reportGroupBySchema.parse(value))
            }
          >
            <SelectTrigger aria-label={t("groupBy")}>
              <span className="text-muted-foreground">{t("groupBy")}:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {reportGroupBySchema.options.map((option: ReportGroupBy) => (
                <SelectItem key={option} value={option}>
                  {t(GROUP_BY_LABELS[option])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
                <CardTitle className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-lg">
                  <span>
                    {t("total", {
                      amount: formatMoney(chart.total, chart.currencySign),
                    })}
                  </span>
                  {dateRangeText ? (
                    <span className="font-normal text-muted-foreground text-sm">
                      {dateRangeText}
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ReportTreemap chart={chart} colorOf={colorOf} />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t(groupBy)}</TableHead>
                      <TableHead className="text-right">
                        {t("amount")}
                      </TableHead>
                      <TableHead className="text-right">{t("share")}</TableHead>
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
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
