"use client";

import { useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Money } from "~/components/app/money";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { usePrimaryCurrency } from "~/hooks/use-primary-currency";
import { filteredHref } from "~/lib/transaction-links";
import { cn } from "~/lib/utils";
import { useTRPC } from "~/trpc/react";

type CurrencySum = { code: string; sign: string; sum: number };

const sumByCurrency = (
  rows: { code: string; sign: string; value: number }[],
  primaryCode?: string,
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
    .sort(
      (a, b) =>
        Number(b.code === primaryCode) - Number(a.code === primaryCode) ||
        a.code.localeCompare(b.code),
    );
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
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
            "text-lg font-semibold",
            tone === "good" && "text-positive",
            tone === "bad" && "text-destructive",
          )}
        />
      ))}
    </div>
  );
}

/** One debtor or creditor; opens their transactions when they are known */
function Person({
  row,
  fallback,
}: {
  row: {
    counterpartyId: string | null;
    counterpartyName: string | null;
    currencySign: string;
    sum: number;
  };
  fallback: string;
}) {
  const className = "flex items-center justify-between gap-2";
  const content = (
    <>
      <span className="truncate">{row.counterpartyName ?? fallback}</span>
      <Money amount={Math.abs(row.sum)} sign={row.currencySign} />
    </>
  );

  return row.counterpartyId ? (
    <Link
      href={filteredHref("/transactions", {
        counterparties: [row.counterpartyId],
      })}
      className={cn(className, "touch:min-h-11 hover:underline")}
    >
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/**
 * Available money, debts, and the accounts list. Clicking an account toggles it
 * in the account filter; without `onToggleAccount` it opens that account's
 * transactions.
 */
export function BalancesSidebar({
  selectedAccounts,
  onToggleAccount,
}: {
  selectedAccounts?: string[];
  onToggleAccount?: (id: string) => void;
}) {
  const t = useTranslations("sidebar");
  const trpc = useTRPC();
  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const debts = useQuery(trpc.counterparties.balances.queryOptions());
  const primary = usePrimaryCurrency();

  if (accounts.isPending || debts.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const active = (accounts.data ?? []).filter((account) => account.isActive);
  const primaryCode = active.find(
    (account) => account.currencyId === primary.currencyId,
  )?.currencyCode;
  const available = sumByCurrency(
    active.map((a) => ({
      code: a.currencyCode,
      sign: a.currencySign,
      value: a.balance,
    })),
    primaryCode,
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
      primaryCode,
    );

  const people = (rows: typeof debtRows) =>
    rows.length === 0 ? null : (
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map((row) => (
          <li key={`${row.counterpartyId}-${row.currencyId}`}>
            <Person row={row} fallback={t("unknown")} />
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
              const selected = selectedAccounts?.includes(account.id) ?? false;
              const className = cn(
                "touch:min-h-11 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                "hover:bg-accent transition-colors",
                selected && "bg-accent font-medium",
              );
              const row = (
                <>
                  <span className="min-w-0 flex-1 truncate">
                    {account.name}
                  </span>
                  <Money
                    amount={account.balance}
                    sign={account.currencySign}
                    className={cn(account.balance < 0 && "text-destructive")}
                  />
                  {selected ? <XIcon className="size-3.5 shrink-0" /> : null}
                </>
              );

              return (
                <li key={account.id}>
                  {onToggleAccount ? (
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onToggleAccount(account.id)}
                      className={className}
                    >
                      {row}
                    </button>
                  ) : (
                    <Link
                      href={filteredHref("/transactions", {
                        accounts: [account.id],
                      })}
                      className={className}
                    >
                      {row}
                    </Link>
                  )}
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
