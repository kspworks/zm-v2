import { useTranslations } from "next-intl";

import {
  HeaderButtonSkeleton,
  LedgerPageSkeleton,
  SearchSkeleton,
  TabsSkeleton,
  TransactionListSkeleton,
} from "~/components/app/skeletons";

export default function Loading() {
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
