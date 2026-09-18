"use client";

import { useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Money } from "~/components/app/money";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { useTRPC } from "~/trpc/react";

type CurrencySum = { code: string; sign: string; sum: number };

const sumByCurrency = (
  rows: { code: string; sign: string; value: number }[],
): CurrencySum[] => {
  const map = new Map<string, CurrencySum>();

  for (const row of rows) {
    const current = map.get(row.code) ?? {
      code: row.code,
      sign: row.sign,
      sum: 0,
    };
    current.sum += row.value;
    map.set(row.code, current);
  }

  return [...map.values()]
    .filter((row) => row.sum !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Totals({
  rows,
  tone,
}: {
  rows: CurrencySum[];
  tone?: "good" | "bad";
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">—</p>;
  }

  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <Money
          key={row.code}
          amount={row.sum}
          sign={row.sign}
          className={cn(
            "font-semibold text-lg",
            tone === "good" && "text-emerald-600 dark:text-emerald-400",
            tone === "bad" && "text-destructive",
          )}
        />
      ))}
    </div>
  );
}

/**
 * Available money, debts, and the accounts list. Clicking an account toggles
 * it in the account filter.
 */
export function BalancesSidebar({
  selectedAccounts,
  onToggleAccount,
}: {
  selectedAccounts: string[];
  onToggleAccount: (id: string) => void;
}) {
  const t = useTranslations("sidebar");
  const trpc = useTRPC();
  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const debts = useQuery(trpc.counterparties.balances.queryOptions());

  if (accounts.isPending || debts.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const active = (accounts.data ?? []).filter((account) => account.isActive);
  const available = sumByCurrency(
    active.map((a) => ({
      code: a.currencyCode,
      sign: a.currencySign,
      value: a.balance,
    })),
  );
  const debtRows = debts.data ?? [];
  const oweMe = debtRows.filter((row) => row.sum > 0);
  const iOwe = debtRows.filter((row) => row.sum < 0);
  const toSums = (rows: typeof debtRows) =>
    sumByCurrency(
      rows.map((r) => ({
        code: r.currencyCode,
        sign: r.currencySign,
        value: r.sum,
      })),
    );

  const people = (rows: typeof debtRows) =>
    rows.length === 0 ? null : (
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map((row) => (
          <li
            key={`${row.counterpartyId}-${row.currencyId}`}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">
              {row.counterpartyName ?? t("unknown")}
            </span>
            <Money amount={Math.abs(row.sum)} sign={row.currencySign} />
          </li>
        ))}
      </ul>
    );

  return (
    <div className="flex flex-col gap-5">
      <Section title={t("available")}>
        <Totals rows={available} />
      </Section>

      {oweMe.length > 0 || iOwe.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          <Section title={t("oweMe")}>
            <Totals rows={toSums(oweMe)} tone="good" />
          </Section>
          <Section title={t("myDebt")}>
            <Totals
              rows={toSums(iOwe).map((row) => ({ ...row, sum: -row.sum }))}
              tone="bad"
            />
          </Section>
        </div>
      ) : null}

      <Separator />

      <Section title={t("accounts")}>
        {active.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("none")}</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {active.map((account) => {
              const selected = selectedAccounts.includes(account.id);

              return (
                <li key={account.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onToggleAccount(account.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                      selected && "bg-accent font-medium",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {account.name}
                    </span>
                    <Money
                      amount={account.balance}
                      sign={account.currencySign}
                      className={cn(account.balance < 0 && "text-destructive")}
                    />
                    {selected ? <XIcon className="size-3.5 shrink-0" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {oweMe.length > 0 ? (
        <Section title={t("oweMe")}>{people(oweMe)}</Section>
      ) : null}
      {iOwe.length > 0 ? (
        <Section title={t("myDebt")}>{people(iOwe)}</Section>
      ) : null}
    </div>
  );
}
