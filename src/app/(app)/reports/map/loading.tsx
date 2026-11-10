import { useTranslations } from "next-intl";

import {
  HeaderButtonSkeleton,
  ReportCardSkeleton,
  TabsSkeleton,
  WidePageSkeleton,
} from "~/components/app/skeletons";

export default function Loading() {
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
