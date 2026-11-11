import { useTranslations } from "next-intl";

import {
  BudgetListSkeleton,
  CategoryListSkeleton,
  DashboardSkeleton,
  HeaderButtonSkeleton,
  ItemListSkeleton,
  LedgerPageSkeleton,
  NarrowPageSkeleton,
  ReportCardSkeleton,
  SearchSkeleton,
  SettingsCardSkeleton,
  TableSkeleton,
  TabsSkeleton,
  TransactionListSkeleton,
  WidePageSkeleton,
} from "~/components/app/skeletons";

/*
 * One skeleton per signed-in route, in two places: the route's `loading.tsx`
 * (while a navigation renders) and the view's `AfterHydration` fallback (the
 * server HTML and the hydration pass of a direct visit). Built from the shared
 * pieces in `skeletons.tsx`; no "use client", so both sides can import it.
 */

export function DashboardPageSkeleton() {
  const t = useTranslations("dashboard");

  return (
    <LedgerPageSkeleton title={t("title")}>
      <DashboardSkeleton />
    </LedgerPageSkeleton>
  );
}

export function TransactionsPageSkeleton() {
  const t = useTranslations("transactions");

  return (
    <LedgerPageSkeleton
      title={t("title")}
      actions={
        <>
          <HeaderButtonSkeleton wide />
          <HeaderButtonSkeleton className="lg:hidden" />
          <HeaderButtonSkeleton />
          <HeaderButtonSkeleton wide className="max-md:hidden" />
        </>
      }
    >
      <SearchSkeleton />
      <TransactionListSkeleton />
    </LedgerPageSkeleton>
  );
}

export function PlannedPageSkeleton() {
  const t = useTranslations("planned");

  return (
    <LedgerPageSkeleton
      title={t("title")}
      actions={
        <>
          <HeaderButtonSkeleton wide />
          <HeaderButtonSkeleton className="lg:hidden" />
          <HeaderButtonSkeleton wide />
        </>
      }
    >
      <SearchSkeleton />
      <TabsSkeleton />
      <TransactionListSkeleton />
    </LedgerPageSkeleton>
  );
}

export function BudgetsPageSkeleton() {
  const t = useTranslations("budgets");

  return (
    <NarrowPageSkeleton
      title={t("title")}
      actions={<HeaderButtonSkeleton wide />}
    >
      <p className="text-muted-foreground text-sm">{t("hint")}</p>
      <BudgetListSkeleton />
    </NarrowPageSkeleton>
  );
}

export function AccountsPageSkeleton() {
  const t = useTranslations("accounts");

  return (
    <NarrowPageSkeleton
      title={t("title")}
      actions={<HeaderButtonSkeleton wide />}
    >
      <ItemListSkeleton icon />
    </NarrowPageSkeleton>
  );
}

export function CategoriesPageSkeleton() {
  const t = useTranslations("categories");

  return (
    <NarrowPageSkeleton
      title={t("title")}
      actions={<HeaderButtonSkeleton wide />}
    >
      <CategoryListSkeleton />
    </NarrowPageSkeleton>
  );
}

export function CounterpartiesPageSkeleton() {
  const t = useTranslations("counterparties");

  return (
    <NarrowPageSkeleton title={t("title")}>
      <p className="text-muted-foreground text-sm">{t("hint")}</p>
      <ItemListSkeleton />
    </NarrowPageSkeleton>
  );
}

export function ReportsMapPageSkeleton() {
  const t = useTranslations("reports");

  return (
    <WidePageSkeleton
      title={
        <>
          {t("title")}{" "}
          <span className="text-muted-foreground">/ {t("map")}</span>
        </>
      }
      actions={<HeaderButtonSkeleton wide />}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsSkeleton />
        <TabsSkeleton className="w-64 max-sm:order-last max-sm:w-full" />
        <TabsSkeleton className="w-32" />
      </div>
      <ReportCardSkeleton />
    </WidePageSkeleton>
  );
}

export function ReportsComparePageSkeleton() {
  const t = useTranslations("reports");

  return (
    <WidePageSkeleton
      title={
        <>
          {t("title")}{" "}
          <span className="text-muted-foreground">/ {t("comparison")}</span>
        </>
      }
      actions={<HeaderButtonSkeleton wide />}
    >
      <div className="bg-card ring-foreground/10 rounded-xl px-2 py-2 ring-1 sm:px-4">
        {/* the period pickers in the table's head */}
        <div className="flex items-center justify-end gap-4 border-b px-2 py-2">
          <TabsSkeleton className="w-[30%] lg:w-52" />
          <TabsSkeleton className="w-[30%] lg:w-52" />
          <div className="w-64 max-lg:hidden" />
        </div>
        <TableSkeleton rows={10} columns={3} />
      </div>
    </WidePageSkeleton>
  );
}

export function SettingsPageSkeleton() {
  const t = useTranslations("settings");

  return (
    <NarrowPageSkeleton title={t("title")}>
      <TabsSkeleton className="w-full" />
      <SettingsCardSkeleton />
      <SettingsCardSkeleton />
    </NarrowPageSkeleton>
  );
}

export function UsersPageSkeleton() {
  const t = useTranslations("users");

  return (
    <NarrowPageSkeleton
      title={t("title")}
      actions={<HeaderButtonSkeleton wide />}
    >
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("people")}</h2>
        <ItemListSkeleton rows={3} value={false} />
      </section>
    </NarrowPageSkeleton>
  );
}
