import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Money } from "~/components/app/money";
import { type ComparisonPair, deltaOf } from "~/lib/report";
import { cn } from "~/lib/utils";

const percentText = (percent: number) =>
  `${percent > 0 ? "+" : ""}${Math.round(percent * 100)}%`;

/**
 * B − A with an arrow, the change relative to A and a bar that grows right
 * of the center line for an increase and left for a decrease, `scale` being
 * the largest |B − A| it is compared with. Green is good for the user:
 * `goodWhen` says which direction that is.
 */
export function DeltaCell({
  pair,
  sign,
  scale,
  goodWhen,
  className,
}: {
  pair: ComparisonPair;
  sign: string;
  scale: number;
  goodWhen: "up" | "down";
  className?: string;
}) {
  const t = useTranslations("reports");
  const { diff, percent } = deltaOf(pair);
  const good = goodWhen === "up" ? diff > 0 : diff < 0;
  // half the track at most; any change stays visible
  const width =
    diff === 0 || scale === 0 ? 0 : Math.max((Math.abs(diff) / scale) * 50, 3);
  const Arrow = diff > 0 ? ArrowUpRightIcon : ArrowDownRightIcon;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-x-2 gap-y-1 @max-4xl:text-xs",
        diff === 0
          ? "text-muted-foreground"
          : good
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-destructive",
        className,
      )}
    >
      <span className="flex items-center gap-0.5">
        {diff === 0 ? null : <Arrow className="size-3.5 shrink-0" />}
        <Money amount={diff} sign={sign} showPlus />
      </span>
      <span className="flex items-center gap-2">
        <span className="@max-4xl:w-auto w-10 text-right text-muted-foreground text-xs tabular-nums">
          {percent === null ? t("newValue") : percentText(percent)}
        </span>
        <span className="relative h-1.5 @max-4xl:w-12 w-16 shrink-0 rounded-full bg-muted">
          <span className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-y-1/2 bg-border" />
          {width > 0 ? (
            <span
              className={cn(
                "absolute inset-y-0 rounded-full",
                good ? "bg-emerald-500" : "bg-destructive",
              )}
              style={
                diff > 0
                  ? { left: "50%", width: `${width}%` }
                  : { right: "50%", width: `${width}%` }
              }
            />
          ) : null}
        </span>
      </span>
    </div>
  );
}
