"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { AlertTriangleIcon, ChartPieIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { AfterHydration } from "~/components/app/after-hydration";
import { Money } from "~/components/app/money";
import { PageHeader } from "~/components/app/page-header";
import { ReportsMapPageSkeleton } from "~/components/app/route-skeletons";
import { LoadingRegion, ReportCardSkeleton } from "~/components/app/skeletons";
import { PeriodPicker } from "~/components/reports/period-picker";
import { ReportTreemap } from "~/components/reports/report-treemap";
import { FilterButton } from "~/components/transactions/filter-bar";
import { useToday } from "~/components/transactions/transaction-groups";
import { useDebtLabelText } from "~/components/transactions/transaction-item";
import { useTransactionFilter } from "~/components/transactions/use-filter";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
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
import { monthOf, type Period } from "~/lib/period";
import {
  buildReport,
  categoryColorOrder,
  colorSlots,
  countChart,
  DEBTS_KEY,
  NONE_KEY,
  type ReportGroupBy,
  type ReportInput,
  reportGroupBySchema,
  SERIES_SLOTS,
  seriesColor,
} from "~/lib/report";
import { filteredHref } from "~/lib/transaction-links";
import { cn } from "~/lib/utils";
import { NO_CATEGORY } from "~/lib/validators/transactions";
import { useTRPC } from "~/trpc/react";

const viewSchema = Schema.Literals(["expense", "income"]);

const GROUP_BY_LABELS = {
  category: "byCategory",
  account: "byAccount",
  counterparty: "byCounterparty",
} as const;

function TileName({ name, href }: { name: string; href: string | null }) {
  return href ? (
    <Link href={href} className="touch:py-2 truncate hover:underline">
      {name}
    </Link>
  ) : (
    <span className="truncate">{name}</span>
  );
}

export function ReportsView() {
  return (
    <AfterHydration fallback={<ReportsMapPageSkeleton />}>
      <Reports />
    </AfterHydration>
  );
}

function Reports() {
  const t = useTranslations("reports");
  const tt = useTranslations("transactions");
  const tf = useTranslations("filters");
  const trpc = useTRPC();
  const today = useToday();
  const debtLabelText = useDebtLabelText();
  const { state, setState, filter } = useTransactionFilter();
  const categories = useQuery(trpc.categories.list.queryOptions());
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
  // transactions left out of the totals, for this visit only;
  // ids outside the current report are simply ignored
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

  /** Leaves these out, or counts them again when all of them are out */
  const toggle = (ids: string[]) =>
    setExcluded((current) => {
      const next = new Set(current);
      const allOut = ids.every((id) => current.has(id));

      for (const id of ids) {
        if (allOut) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      return next;
    });

  /** Counts these again (true) or leaves them all out (false) */
  const setCounted = (ids: string[], counted: boolean) =>
    setExcluded((current) => {
      const next = new Set(current);

      for (const id of ids) {
        if (counted) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      return next;
    });

  // the range is required: without a valid one in the URL, this calendar
  // month, the same one the dashboard and the comparison open on
  const period = useMemo(
    (): Period =>
      filter.startDate && filter.endDate
        ? { startDate: filter.startDate, endDate: filter.endDate }
        : monthOf(today),
    [filter.startDate, filter.endDate, today],
  );

  const dateRangeText = `${formatDisplayDate(period.startDate)} – ${formatDisplayDate(period.endDate)}`;

  const data = useQuery({
    ...trpc.reports.data.queryOptions({ filter: { ...filter, ...period } }),
    placeholderData: keepPreviousData,
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

  // one color per category wherever it appears, oldest first so a new one
  // takes the next color; "no category" is gray
  const colorOf = useMemo(() => {
    const order =
      groupBy === "category" ? categoryColorOrder(categories.data ?? []) : [];
    const slots = colorSlots(charts, SERIES_SLOTS, order);

    return (key: string) => seriesColor(key, slots.get(key));
  }, [charts, categories.data, groupBy]);

  // the rows behind a tile, in this report's period and filters
  const hrefOf = useMemo(() => {
    const scope = { ...filter, ...period };
    const leafIds = new Map<string, Set<string>>();

    for (const row of data.data?.rows ?? []) {
      const top = row.parentId ?? row.categoryId;

      if (top && row.categoryId) {
        leafIds.set(top, (leafIds.get(top) ?? new Set()).add(row.categoryId));
      }
    }

    return (key: string): string | null => {
      if (key === DEBTS_KEY) {
        return null;
      }

      switch (groupBy) {
        case "account":
          return filteredHref("/transactions", { ...scope, accounts: [key] });
        case "counterparty":
          return key === NONE_KEY
            ? null
            : filteredHref("/transactions", {
                ...scope,
                counterparties: [key],
              });
        default:
          return filteredHref("/transactions", {
            ...scope,
            categories:
              key === NONE_KEY ? [NO_CATEGORY] : [...(leafIds.get(key) ?? [])],
          });
      }
    };
  }, [data.data, filter, period, groupBy]);

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
            // the period is not a filter here, so Reset keeps it
            reset={() =>
              void setState({
                accounts: null,
                categories: null,
                counterparties: null,
                kinds: null,
                amount: null,
                comment: null,
              })
            }
            withDates={false}
          />
        }
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
        <div className="@container flex flex-wrap items-center justify-between gap-2">
          <Tabs
            value={view}
            onValueChange={(value) =>
              setView(Schema.decodeUnknownSync(viewSchema)(value))
            }
          >
            <TabsList>
              <TabsTrigger value="expense">{t("expense")}</TabsTrigger>
              <TabsTrigger value="income">{t("income")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <PeriodPicker
            label={tf("dates")}
            value={period}
            onChange={(next) =>
              void setState({
                startDate: next.startDate,
                endDate: next.endDate,
              })
            }
            arrows="always"
            className="w-auto max-sm:order-last max-sm:w-full @4xl:w-64"
          />
          <Select
            value={groupBy}
            onValueChange={(value) =>
              setGroupBy(Schema.decodeUnknownSync(reportGroupBySchema)(value))
            }
          >
            <SelectTrigger aria-label={t("groupBy")}>
              <span className="text-muted-foreground max-sm:hidden">
                {t("groupBy")}:
              </span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {reportGroupBySchema.literals.map((option: ReportGroupBy) => (
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
          <LoadingRegion>
            <ReportCardSkeleton />
          </LoadingRegion>
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
          charts.map((chart) => {
            const count = countChart(chart, excluded);

            return (
              <Card key={chart.currencyCode}>
                <CardHeader>
                  {charts.length > 1 ? (
                    <CardDescription>{chart.currencyCode}</CardDescription>
                  ) : null}
                  <CardTitle className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-lg">
                    <span>
                      {t("total", {
                        amount: formatMoney(count.total, chart.currencySign),
                      })}
                    </span>
                    <span className="text-muted-foreground text-sm font-normal">
                      {dateRangeText}
                    </span>
                  </CardTitle>
                  {count.excludedTotal > 0 ? (
                    <CardDescription className="flex flex-wrap items-center gap-x-2">
                      <span className="tabular-nums">
                        {t("leftOut", {
                          total: formatMoney(chart.total, chart.currencySign),
                          left: formatMoney(
                            count.excludedTotal,
                            chart.currencySign,
                          ),
                        })}
                      </span>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setExcluded(new Set())}
                      >
                        <RotateCcwIcon />
                        {t("includeAll")}
                      </Button>
                    </CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <ReportTreemap
                    chart={chart}
                    colorOf={colorOf}
                    excluded={excluded}
                    onToggle={toggle}
                  />
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">
                          <span className="sr-only">{t("counted")}</span>
                        </TableHead>
                        <TableHead>{t(groupBy)}</TableHead>
                        <TableHead className="text-right">
                          {t("amount")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("share")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chart.tiles.map((tile) => {
                        const tileCount = count.tiles.get(tile.key);
                        const allOut = tileCount?.excluded === "all";
                        const value = tileCount?.value ?? tile.value;

                        return (
                          <TableRow
                            key={tile.key}
                            className={cn(allOut && "text-muted-foreground")}
                          >
                            <TableCell className="w-8">
                              <Checkbox
                                checked={!allOut}
                                aria-label={t("countTile", { name: tile.name })}
                                onCheckedChange={(checked) =>
                                  setCounted(
                                    tile.children.map((leaf) => leaf.id),
                                    checked === true,
                                  )
                                }
                              />
                            </TableCell>
                            {/* the name gives way, so numbers are never cut off */}
                            <TableCell className="w-full max-w-0">
                              <span className="flex min-w-0 items-center gap-2">
                                <span
                                  className={cn(
                                    "size-2.5 shrink-0 rounded-sm",
                                    allOut && "opacity-30",
                                  )}
                                  style={{ background: colorOf(tile.key) }}
                                />
                                <TileName
                                  name={tile.name}
                                  href={hrefOf(tile.key)}
                                />
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Money amount={value} sign={chart.currencySign} />
                            </TableCell>
                            <TableCell className="text-muted-foreground text-right tabular-nums">
                              {allOut || count.total <= 0
                                ? "—"
                                : `${((value / count.total) * 100).toFixed(1)}%`}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}
