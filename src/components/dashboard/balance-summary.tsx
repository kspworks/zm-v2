"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Money } from "~/components/app/money";
import { useTRPC } from "~/trpc/react";

/**
 * The headline on screens without the balances sidebar: the money available
 * in the dashboard's currency and the debts in it. Spans only, because
 * `LedgerLayout` puts it inside a button that opens the full balances.
 */
export function BalanceSummary({
  available,
  sign,
  currencyId,
}: {
  available: number;
  sign: string;
  currencyId: string;
}) {
  const t = useTranslations("sidebar");
  const trpc = useTRPC();
  const debts = useQuery(trpc.counterparties.balances.queryOptions());
  const rows = (debts.data ?? []).filter(
    (row) => row.currencyId === currencyId,
  );
  const sumOf = (test: (sum: number) => boolean) =>
    rows.reduce((sum, row) => (test(row.sum) ? sum + row.sum : sum), 0);
  const oweMe = sumOf((sum) => sum > 0);
  const myDebt = -sumOf((sum) => sum < 0);

  return (
    <span className="bg-card ring-foreground/10 flex items-center gap-3 rounded-xl p-4 ring-1">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("available")}
        </span>
        <Money
          amount={available}
          sign={sign}
          className="text-2xl font-semibold"
        />
        {oweMe > 0 || myDebt > 0 ? (
          <span className="text-muted-foreground flex flex-wrap gap-x-4 text-sm">
            {oweMe > 0 ? (
              <span>
                {t("oweMe")} <Money amount={oweMe} sign={sign} colored />
              </span>
            ) : null}
            {myDebt > 0 ? (
              <span>
                {t("myDebt")}{" "}
                <Money
                  amount={myDebt}
                  sign={sign}
                  className="text-destructive"
                />
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <ChevronRightIcon className="text-muted-foreground size-5 shrink-0" />
    </span>
  );
}
