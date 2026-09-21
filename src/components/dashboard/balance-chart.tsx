"use client";

import { format, parseISO } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import { Money } from "~/components/app/money";
import { useEntryLabel } from "~/components/dashboard/use-entry-label";
import { type ChartConfig, ChartContainer } from "~/components/ui/chart";
import type { Locale } from "~/i18n/config";
import type { BalancePoint } from "~/lib/dashboard";
import { dateFnsLocale, formatListDate } from "~/lib/dates";
import { formatMoney } from "~/lib/money";
import { cn } from "~/lib/utils";

/** Whole units with thousands grouping, for the Y axis */
const axisMoney = (minor: number) =>
  formatMoney(Math.round(minor / 100) * 100).replace(/\.00$/, "");

/** Y axis tick that can pick out the zero line, where the money runs out */
function MoneyTick({
  x,
  y,
  payload,
  highlightZero,
}: {
  x?: number | string;
  y?: number | string;
  payload?: { value: number };
  highlightZero?: boolean;
}) {
  const zero = highlightZero && payload?.value === 0;
  return (
    <text
      x={x}
      y={y}
      dy="0.355em"
      textAnchor="end"
      className={
        zero ? "fill-destructive font-semibold" : "fill-muted-foreground"
      }
    >
      {axisMoney(payload?.value ?? 0)}
    </text>
  );
}

function PointTooltip({
  active,
  payload,
  today,
  sign,
}: Pick<TooltipContentProps, "active" | "payload"> & {
  today: string;
  sign: string;
}) {
  const t = useTranslations("dashboard.balance");
  const locale = useLocale() as Locale;
  const label = useEntryLabel();
  const point = payload?.[0]?.payload as BalancePoint | undefined;

  if (!active || !point) {
    return null;
  }

  return (
    <div className="grid w-64 max-w-[80vw] gap-2 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-medium">
        {formatListDate(point.date, today, locale)}
      </div>
      <div className="grid gap-0.5">
        {point.actual !== null ? (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full bg-(--color-actual)" />
              {t("actual")}
            </span>
            <Money amount={point.actual} sign={sign} className="font-medium" />
          </div>
        ) : null}
        {point.planned !== null ? (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full bg-(--color-planned)" />
              {t("planned")}
            </span>
            <Money amount={point.planned} sign={sign} className="font-medium" />
          </div>
        ) : null}
      </div>
      <div className="grid gap-1 border-t pt-2">
        {point.items.length === 0 ? (
          <span className="text-muted-foreground">{t("noChanges")}</span>
        ) : (
          point.items.map((item) => (
            <div
              key={item.id}
              className={cn(
                "flex items-baseline justify-between gap-2",
                item.planned && "text-muted-foreground",
              )}
            >
              <span className="min-w-0 truncate">
                {label(item)}
                {item.overdue ? (
                  <span className="ml-1 text-destructive">
                    · {t("overdue")}
                  </span>
                ) : null}
              </span>
              <Money amount={item.net} showPlus colored />
            </div>
          ))
        )}
        {point.more > 0 ? (
          <span className="text-muted-foreground">
            {t("more", { count: point.more })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Actual balance up to today, then the planned one, a dot per day */
export function BalanceChart({
  points,
  today,
  sign,
}: {
  points: BalancePoint[];
  today: string;
  sign: string;
}) {
  const t = useTranslations("dashboard.balance");
  const locale = useLocale() as Locale;
  const config = {
    actual: { label: t("actual"), color: "var(--series-1)" },
    planned: { label: t("planned"), color: "var(--series-2)" },
  } satisfies ChartConfig;
  // many days: smaller dots so the line stays readable
  const r = points.length > 45 ? 1.5 : 2.5;
  // the below-zero tint reaches past the lowest point, clipped to the plot
  const lowest = Math.min(
    0,
    ...points.flatMap((p) => [p.actual ?? 0, p.planned ?? 0]),
  );
  const belowZero = lowest < 0;

  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full sm:h-80">
      <LineChart
        data={points}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickFormatter={(date: string) =>
            format(parseISO(date), "d MMM", { locale: dateFnsLocale(locale) })
          }
        />
        <YAxis
          width={72}
          tickLine={false}
          axisLine={false}
          tick={<MoneyTick highlightZero={belowZero} />}
          domain={["auto", "auto"]}
        />
        <ReferenceLine
          x={today}
          stroke="var(--muted-foreground)"
          strokeDasharray="3 3"
          strokeOpacity={0.6}
        />
        {/* zero is marked only once the balance goes below it */}
        {belowZero ? (
          <>
            <ReferenceArea
              y1={lowest * 2}
              y2={0}
              fill="var(--destructive)"
              fillOpacity={0.06}
              strokeOpacity={0}
              ifOverflow="hidden"
            />
            <ReferenceLine
              y={0}
              stroke="var(--destructive)"
              strokeWidth={1.5}
              strokeOpacity={0.8}
              ifOverflow="discard"
            />
          </>
        ) : null}
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          content={({ active, payload }) => (
            <PointTooltip
              active={active}
              payload={payload}
              today={today}
              sign={sign}
            />
          )}
        />
        <Line
          dataKey="actual"
          type="linear"
          stroke="var(--color-actual)"
          strokeWidth={2}
          dot={{ r, strokeWidth: 0, fill: "var(--color-actual)" }}
          activeDot={{ r: 5 }}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="planned"
          type="linear"
          stroke="var(--color-planned)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ r, strokeWidth: 0, fill: "var(--color-planned)" }}
          activeDot={{ r: 5 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
