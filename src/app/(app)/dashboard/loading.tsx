import { useTranslations } from "next-intl";

import {
  DashboardSkeleton,
  LedgerPageSkeleton,
} from "~/components/app/skeletons";

export default function Loading() {
  const t = useTranslations("dashboard");

  return (
    <LedgerPageSkeleton title={t("title")}>
      <DashboardSkeleton />
    </LedgerPageSkeleton>
  );
}
