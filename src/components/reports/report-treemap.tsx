"use client";

import { useTranslations } from "next-intl";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { formatDisplayDate } from "~/lib/dates";
import { formatMoney } from "~/lib/money";
import type { ReportChart } from "~/lib/report";
import { type LeafRect, layoutReport } from "~/lib/treemap-layout";

const HEIGHT = 360;
const BAND = 26;
/** Rows listed in the tooltip of a merged leaf. */
const GROUP_ROWS = 8;

type Hover = { leaf: LeafRect; x: number; y: number };

function LeafTooltip({ leaf, sign }: { leaf: LeafRect; sign: string }) {
  const t = useTranslations("reports");

  if (leaf.leaves.length > 1) {
    const rest = leaf.leaves.length - GROUP_ROWS;

    return (
      <div className="grid min-w-52 gap-1 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
        {leaf.leaves.slice(0, GROUP_ROWS).map((item) => (
          <div key={item.id} className="flex justify-between gap-4">
            <span className="max-w-40 truncate">
              <span className="text-muted-foreground">
                {formatDisplayDate(item.date)}
              </span>{" "}
              {item.name}
            </span>
            <span className="whitespace-nowrap font-medium tabular-nums">
              {formatMoney(item.value, sign)}
            </span>
          </div>
        ))}
        {rest > 0 ? (
          <span className="text-muted-foreground">
            {t("more", { count: rest })}
          </span>
        ) : null}
        <div className="flex justify-between gap-4 border-t pt-1">
          <span className="text-muted-foreground">{t("amount")}</span>
          <span className="whitespace-nowrap font-medium tabular-nums">
            {formatMoney(leaf.value, sign)}
          </span>
        </div>
      </div>
    );
  }

  const item = leaf.leaves[0];

  if (!item) {
    return null;
  }

  return (
    <div className="grid min-w-44 gap-1 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">{t("date")}</span>
        <span>{formatDisplayDate(item.date)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">{t("category")}</span>
        <span className="truncate">{item.category}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">{t("amount")}</span>
        <span className="whitespace-nowrap font-medium tabular-nums">
          {formatMoney(item.value, sign)}
        </span>
      </div>
      {item.comment ? (
        <p className="max-w-60 text-muted-foreground">{item.comment}</p>
      ) : null}
    </div>
  );
}

/**
 * Leaves are filled with the tile's series color; small ones that would be
 * slivers sit in a band along the tile's bottom (see `layoutReport`). Tiles
 * carry a direct label on a surface chip, so identity never depends on color,
 * and are separated by a 2px surface gap.
 */
export function ReportTreemap({
  chart,
  colorOf,
}: {
  chart: ReportChart;
  colorOf: (key: string) => string;
}) {
  const t = useTranslations("reports");
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const { tiles, leaves } = layoutReport(
    chart,
    { width, height: HEIGHT },
    { band: BAND },
  );
  const sign = chart.currencySign;

  const describe = (leaf: LeafRect) =>
    leaf.leaves.length > 1
      ? `${t("more", { count: leaf.leaves.length })} — ${formatMoney(leaf.value, sign)}`
      : `${leaf.leaves[0]?.name} — ${formatMoney(leaf.value, sign)}, ${formatDisplayDate(leaf.leaves[0]?.date ?? "")}`;

  const pointAt = (leaf: LeafRect, event: PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();

    setHover({
      leaf,
      x: event.clientX - (box?.left ?? 0),
      y: event.clientY - (box?.top ?? 0),
    });
  };

  return (
    <div ref={ref} className="relative h-[360px] w-full">
      {width > 0 ? (
        <svg
          width={width}
          height={HEIGHT}
          aria-label={t("total", { amount: formatMoney(chart.total, sign) })}
          className="block"
        >
          {leaves.map((leaf) => {
            const label =
              leaf.leaves.length > 1
                ? t("more", { count: leaf.leaves.length })
                : formatMoney(leaf.value, sign);
            const inBand = leaf.height <= BAND;
            const showLabel = leaf.width > 58 && leaf.height >= BAND - 2;

            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only reveal the tooltip; the label carries the same facts
              <g
                key={leaf.key}
                tabIndex={0}
                aria-label={describe(leaf)}
                className="outline-none"
                onPointerEnter={(event) => pointAt(leaf, event)}
                onPointerMove={(event) => pointAt(leaf, event)}
                onPointerLeave={() => setHover(null)}
                onFocus={() =>
                  setHover({
                    leaf,
                    x: leaf.x + leaf.width / 2,
                    y: leaf.y + leaf.height / 2,
                  })
                }
                onBlur={() => setHover(null)}
              >
                <rect
                  x={leaf.x}
                  y={leaf.y}
                  width={leaf.width}
                  height={leaf.height}
                  fill={colorOf(leaf.tileKey)}
                  fillOpacity={
                    hover?.leaf.key === leaf.key
                      ? 1
                      : leaf.leaves.length > 1
                        ? 0.6
                        : 0.9
                  }
                  stroke="var(--background)"
                  strokeWidth={1}
                  strokeDasharray={leaf.leaves.length > 1 ? "3 2" : undefined}
                />
                {showLabel ? (
                  <foreignObject
                    x={leaf.x + 3}
                    y={inBand ? leaf.y + 3 : leaf.y + leaf.height - 23}
                    width={leaf.width - 6}
                    height={20}
                    pointerEvents="none"
                  >
                    <span className="inline-block max-w-full truncate rounded bg-background/70 px-1 text-[11px] text-foreground leading-4">
                      {label}
                    </span>
                  </foreignObject>
                ) : null}
              </g>
            );
          })}
          {tiles.map((tile) => {
            const label = tile.name;
            const showLabel = tile.width > 64 && tile.height > 26;

            return (
              <g key={tile.key} pointerEvents="none" aria-hidden>
                <rect
                  x={tile.x}
                  y={tile.y}
                  width={tile.width}
                  height={tile.height}
                  rx={4}
                  fill="none"
                  stroke="var(--background)"
                  strokeWidth={2}
                />
                {showLabel ? (
                  <foreignObject
                    x={tile.x + 4}
                    y={tile.y + 4}
                    width={tile.width - 8}
                    height={24}
                  >
                    <span className="inline-block max-w-full truncate rounded bg-background/90 px-1.5 py-0.5 font-medium text-foreground text-xs shadow-sm">
                      {label}
                    </span>
                  </foreignObject>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : null}
      {hover ? (
        <div
          className="pointer-events-none absolute z-20"
          style={{
            left: hover.x,
            top: hover.y,
            transform: `translate(${hover.x > width / 2 ? "calc(-100% - 12px)" : "12px"}, ${hover.y > HEIGHT / 2 ? "calc(-100% - 12px)" : "12px"})`,
          }}
        >
          <LeafTooltip leaf={hover.leaf} sign={sign} />
        </div>
      ) : null}
    </div>
  );
}
