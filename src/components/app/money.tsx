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
        colored && amount > 0 && "text-positive",
        className,
      )}
    >
      {hideSign ? null : parts.sign}
      {parts.integral}
      <span className="opacity-60 in-[.text-destructive]:opacity-100 in-[.text-muted-foreground]:opacity-100 in-[.text-positive]:opacity-100 dark:in-[.text-destructive]:opacity-80 dark:in-[.text-positive]:opacity-80">
        .{parts.fraction}
      </span>
      {sign ? (
        <span className="ml-1 font-normal opacity-80 in-[.text-destructive]:opacity-100 in-[.text-muted-foreground]:opacity-100 in-[.text-positive]:opacity-100">
          {sign}
        </span>
      ) : null}
    </span>
  );
}
