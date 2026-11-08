"use client";

import { useTranslations } from "next-intl";

import { Money } from "~/components/app/money";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/types";

export type Budget = RouterOutputs["budgets"]["list"][number];

export const budgetName = (budget: Budget) =>
  budget.parentName
    ? `${budget.parentName} → ${budget.categoryName}`
    : budget.categoryName;

/** Spent against the limit; the words say over or left, not just the color */
export function BudgetProgress({ budget }: { budget: Budget }) {
  const t = useTranslations("budgets");
  const ratio = budget.spent / budget.amount;
  const left = budget.amount - budget.spent;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium">
          {budgetName(budget)}
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          <Money amount={budget.spent} sign={budget.currencySign} />
          {" / "}
          <Money amount={budget.amount} sign={budget.currencySign} />
        </span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a native <meter> can't be themed alike across browsers */}
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="meter"
        aria-label={budgetName(budget)}
        aria-valuemin={0}
        aria-valuemax={budget.amount}
        aria-valuenow={budget.spent}
      >
        <div
          className={cn(
            "h-full rounded-full",
            ratio > 1
              ? "bg-destructive"
              : ratio >= 0.85
                ? "bg-amber-500"
                : "bg-primary",
          )}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
      <span
        className={cn(
          "text-xs",
          left < 0 ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {left < 0 ? t("over") : t("left")}{" "}
        <Money amount={Math.abs(left)} sign={budget.currencySign} />
      </span>
    </div>
  );
}
