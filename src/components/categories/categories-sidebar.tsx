"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Money } from "~/components/app/money";
import {
  CategoriesSidebarSkeleton,
  LoadingRegion,
} from "~/components/app/skeletons";
import type { Period } from "~/lib/period";
import { buildReport, NONE_KEY, type ReportInput } from "~/lib/report";
import { filteredHref } from "~/lib/transaction-links";
import { NO_CATEGORY } from "~/lib/validators/transactions";

/** How many categories the month's breakdown lists */
const TOP = 8;

/**
 * This month's spending (or income, on the Income tab) by top-level
 * category, one block per currency, in the categories' report colors. Each
 * line opens the month's transactions in that category.
 */
export function CategoriesSidebar({
  rows,
  pending,
  kind,
  period,
  primaryCode,
  colorOf,
  leafIdsOf,
}: {
  rows: ReportInput[];
  pending: boolean;
  kind: "expense" | "income";
  period: Period;
  primaryCode?: string;
  colorOf: (key: string) => string;
  /** A top-level category and its subcategories, as filter ids */
  leafIdsOf: (id: string) => string[];
}) {
  const t = useTranslations("categories");
  const tt = useTranslations("transactions");

  const charts = useMemo(
    () =>
      buildReport(
        // transfers and debts are not spending
        rows.filter((row) => row.kind === kind),
        kind,
        "category",
        {
          noCategory: tt("noCategory"),
          noCounterparty: "",
          debts: "",
          debtDescription: () => "",
        },
      ).sort(
        (a, b) =>
          Number(b.currencyCode === primaryCode) -
          Number(a.currencyCode === primaryCode),
      ),
    [rows, kind, primaryCode, tt],
  );

  if (pending) {
    return (
      <LoadingRegion>
        <CategoriesSidebarSkeleton />
      </LoadingRegion>
    );
  }

  const heading =
    "text-muted-foreground text-xs font-medium tracking-wide uppercase";
  const title = kind === "income" ? t("monthIncome") : t("monthExpense");

  return (
    <div className="flex flex-col gap-5">
      {charts.length === 0 ? (
        <section className="flex flex-col gap-1.5">
          <h3 className={heading}>{title}</h3>
          <p className="text-muted-foreground text-sm">—</p>
        </section>
      ) : (
        charts.map((chart) => {
          const max = chart.tiles[0]?.value ?? 0;

          return (
            <section key={chart.currencyCode} className="flex flex-col gap-2">
              <div className="flex flex-col gap-1.5">
                <h3 className={heading}>{title}</h3>
                <Money
                  amount={chart.total}
                  sign={chart.currencySign}
                  className="text-lg font-semibold"
                />
              </div>
              <ul className="-mx-2 flex flex-col">
                {chart.tiles.slice(0, TOP).map((tile) => (
                  <li key={tile.key}>
                    <Link
                      href={filteredHref("/transactions", {
                        ...period,
                        categories:
                          tile.key === NONE_KEY
                            ? [NO_CATEGORY]
                            : leafIdsOf(tile.key),
                      })}
                      className="touch:min-h-11 hover:bg-accent flex flex-col gap-1 rounded-md px-2 py-1.5 text-sm transition-colors"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{tile.name}</span>
                        <Money amount={tile.value} sign={chart.currencySign} />
                      </span>
                      <span className="bg-muted h-1.5 overflow-hidden rounded-full">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${max ? Math.max((tile.value / max) * 100, 2) : 0}%`,
                            background: colorOf(tile.key),
                          }}
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      <Link
        href="/reports/map"
        className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
      >
        {t("openReport")} →
      </Link>
    </div>
  );
}
