import { useTranslations } from "next-intl";

import {
  HeaderButtonSkeleton,
  LedgerPageSkeleton,
  SearchSkeleton,
  TransactionListSkeleton,
} from "~/components/app/skeletons";

export default function Loading() {
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
