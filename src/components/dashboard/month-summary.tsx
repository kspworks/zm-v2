"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Money } from "~/components/app/money";
import { LoadingRegion, StatsSkeleton } from "~/components/app/skeletons";
import { BudgetProgress } from "~/components/budgets/budget-progress";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { formatMoney } from "~/lib/money";
import { cn } from "~/lib/utils";
import { useTRPC } from "~/trpc/react";

/** The change against last month, worded so the color is never the only cue */
function Delta({
  current,
  previous,
  goodWhen,
}: {
  current: number;
  previous: number;
  goodWhen: "up" | "down";
}) {
  const t = useTranslations("dashboard.month");

  if (previous === 0) {
    return null;
  }

  const change = Math.round(((current - previous) / Math.abs(previous)) * 100);
  const good = goodWhen === "up" ? change >= 0 : change <= 0;

  return (
    <span
      className={cn("text-xs", good ? "text-positive" : "text-destructive")}
    >
      {t("vsLast", { change: `${change > 0 ? "+" : ""}${change}%` })}
    </span>
  );
}

/** This month so far in one currency, and the budgets closest to their limit */
export function MonthSummary({ currencyId }: { currencyId: string }) {
  const t = useTranslations("dashboard.month");
  const trpc = useTRPC();
  const month = useQuery(trpc.dashboard.month.queryOptions());
  const budgets = useQuery(trpc.budgets.list.queryOptions());

  const current = month.data?.current.find((r) => r.currencyId === currencyId);
  const previous = month.data?.previous.find(
    (r) => r.currencyId === currencyId,
  );
  const sign = current?.currencySign ?? previous?.currencySign ?? "";
  const mine = (budgets.data ?? []).filter((b) => b.currencyId === currencyId);

  const stat = (
    label: string,
    value: number,
    before: number,
    goodWhen: "up" | "down",
    className?: string,
    debts = 0,
  ) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      <Money
        amount={value}
        sign={sign}
        className={cn("text-lg font-semibold", className)}
      />
      <Delta current={value} previous={before} goodWhen={goodWhen} />
      {/* lending and repayments move money without being earned or spent */}
      {debts ? (
        <span className="text-muted-foreground text-xs">
          {t("inclDebts", { amount: formatMoney(debts, sign) })}
        </span>
      ) : null}
    </div>
  );

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {month.data?.days
            ? t("comparedDays", { days: month.data.days })
            : t("comparedMonth")}
        </CardDescription>
        <CardAction>
          <Link
            href="/budgets"
            className="text-primary text-sm underline-offset-4 hover:underline dark:text-sky-400"
          >
            {mine.length ? t("allBudgets") : t("setBudget")}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {month.isPending ? (
          <LoadingRegion>
            <StatsSkeleton />
          </LoadingRegion>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {stat(
              t("income"),
              current?.incomes ?? 0,
              previous?.incomes ?? 0,
              "up",
              "text-positive",
              current?.debtIncomes,
            )}
            {stat(
              t("expenses"),
              -(current?.expenses ?? 0),
              -(previous?.expenses ?? 0),
              "down",
              undefined,
              -(current?.debtExpenses ?? 0),
            )}
            {stat(
              t("net"),
              current?.total ?? 0,
              previous?.total ?? 0,
              "up",
              (current?.total ?? 0) < 0 ? "text-destructive" : undefined,
            )}
          </div>
        )}
        {mine.length ? (
          <div className="flex flex-col gap-4 border-t pt-4">
            {mine.slice(0, 3).map((budget) => (
              <BudgetProgress key={budget.id} budget={budget} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
