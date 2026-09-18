"use client";

import { useQuery } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Money } from "~/components/app/money";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { TransactionFilter } from "~/lib/validators/transactions";
import { useTRPC } from "~/trpc/react";

/** Server-side totals over the whole filtered set, shown while filtering */
export function TotalsBar({ filter }: { filter: TransactionFilter }) {
  const t = useTranslations("transactions.totals");
  const trpc = useTRPC();
  const totals = useQuery(trpc.transactions.totals.queryOptions({ filter }));

  if (!totals.data?.length) {
    return null;
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm sm:px-4">
      <div className="grid flex-1 grid-cols-[auto_1fr_1fr_1fr] gap-x-4 gap-y-1">
        <span />
        <span className="text-muted-foreground text-xs">{t("expenses")}</span>
        <span className="text-muted-foreground text-xs">{t("incomes")}</span>
        <span className="text-muted-foreground text-xs">{t("total")}</span>
        {totals.data.map((row) => (
          <div key={row.currencyId} className="contents">
            <span className="font-medium text-muted-foreground">
              {row.currencyCode}
            </span>
            {row.expenses ? (
              <Money amount={row.expenses} sign={row.currencySign} />
            ) : (
              <span />
            )}
            {row.incomes ? (
              <Money
                amount={row.incomes}
                sign={row.currencySign}
                showPlus
                colored
              />
            ) : (
              <span />
            )}
            <Money
              amount={row.total}
              sign={row.currencySign}
              showPlus
              colored
              className="font-semibold"
            />
          </div>
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <InfoIcon
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-label={t("hint")}
          />
        </TooltipTrigger>
        <TooltipContent className="max-w-60">{t("hint")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
