import { splitMoney } from "~/lib/money";
import { cn } from "~/lib/utils";

/**
 * An amount in minor units: "-1 234.56 ₴" with dimmed decimals. Hook-free, so
 * it also renders inside emails.
 */
export function Money({
  amount,
  sign,
  showPlus = false,
  hideSign = false,
  colored = false,
  className,
}: {
  amount: number;
  sign?: string | null;
  showPlus?: boolean;
  hideSign?: boolean;
  colored?: boolean;
  className?: string;
}) {
  const parts = splitMoney(amount, { showPlus });

  return (
    <span
      className={cn(
        "whitespace-nowrap tabular-nums",
        colored && amount > 0 && "text-emerald-600 dark:text-emerald-400",
        className,
      )}
    >
      {hideSign ? null : parts.sign}
      {parts.integral}
      <span className="opacity-60">.{parts.fraction}</span>
      {sign ? (
        <span className="ml-1 font-normal opacity-80">{sign}</span>
      ) : null}
    </span>
  );
}
