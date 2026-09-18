"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Tooltip, Treemap } from "recharts";

import { ChartContainer } from "~/components/ui/chart";
import { formatDisplayDate } from "~/lib/dates";
import { formatMoney } from "~/lib/money";
import type { ReportChart, ReportLeaf } from "~/lib/report";

type TileProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  depth?: number;
  name?: string;
  value?: number;
  fill?: string;
};

/**
 * Tiles are filled with the category's series color and separated by a 2px
 * surface gap. Top-level tiles carry a direct label on a surface chip, so
 * identity never depends on color, and label text stays in text tokens.
 */
function Tile({
  sign,
  overlay = false,
  ...props
}: TileProps & { sign: string; overlay?: boolean }) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    depth = 0,
    name,
    value,
    fill,
  } = props;

  if (depth === 0 || width <= 0 || height <= 0) {
    return null;
  }

  if (!overlay && depth === 1) {
    return null;
  }

  if (depth === 2) {
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={0.9}
        stroke="var(--background)"
        strokeWidth={1}
      />
    );
  }

  const label = `${name} — ${formatMoney(value ?? 0, sign)}`;
  const showLabel = width > 64 && height > 26;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill="none"
        stroke="var(--background)"
        strokeWidth={2}
      />
      {showLabel ? (
        <foreignObject x={x + 4} y={y + 4} width={width - 8} height={24}>
          <span className="inline-block max-w-full truncate rounded bg-background/90 px-1.5 py-0.5 font-medium text-foreground text-xs shadow-sm">
            {label}
          </span>
        </foreignObject>
      ) : null}
    </g>
  );
}

export function ReportTreemap({
  chart,
  colorOf,
}: {
  chart: ReportChart;
  colorOf: (key: string) => string;
}) {
  const t = useTranslations("reports");
  const format = useFormatter();

  const data = chart.tiles.map((tile) => ({
    name: tile.name,
    value: tile.value,
    fill: colorOf(tile.key),
    children: tile.children.map((leaf) => ({
      ...leaf,
      fill: colorOf(tile.key),
    })),
  }));

  // Recharts paints leaves after their parent, which would cover the parent's
  // label; a second, identical layout of the top level only is laid over it
  // for the labels and the 2px surface gaps, and lets the pointer through
  const topLevel = data.map(({ children: _, ...tile }) => tile);

  return (
    <div className="relative h-[360px] w-full">
      <ChartContainer config={{}} className="aspect-auto h-[360px] w-full">
        <Treemap
          data={data}
          dataKey="value"
          nameKey="name"
          isAnimationActive={false}
          content={<Tile sign={chart.currencySign} />}
        >
          <Tooltip
            cursor={false}
            wrapperStyle={{ zIndex: 20 }}
            content={({ active, payload }) => {
              const leaf = payload?.[0]?.payload as
                | Partial<ReportLeaf>
                | undefined;

              if (!active || !leaf?.date) {
                return null;
              }

              return (
                <div className="grid min-w-44 gap-1 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{t("date")}</span>
                    <span>{formatDisplayDate(leaf.date)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">
                      {t("category")}
                    </span>
                    <span className="truncate">{leaf.category}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{t("amount")}</span>
                    <span className="font-medium tabular-nums">
                      {formatMoney(leaf.value ?? 0, chart.currencySign)}
                    </span>
                  </div>
                  {leaf.comment ? (
                    <p className="max-w-60 text-muted-foreground">
                      {leaf.comment}
                    </p>
                  ) : null}
                  <span className="sr-only">
                    {format.number(leaf.value ?? 0)}
                  </span>
                </div>
              );
            }}
          />
        </Treemap>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <ChartContainer config={{}} className="aspect-auto h-[360px] w-full">
          <Treemap
            data={topLevel}
            dataKey="value"
            nameKey="name"
            isAnimationActive={false}
            content={<Tile sign={chart.currencySign} overlay />}
          />
        </ChartContainer>
      </div>
    </div>
  );
}
