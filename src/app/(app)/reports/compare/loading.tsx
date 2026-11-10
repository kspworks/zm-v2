import { useTranslations } from "next-intl";

import {
  HeaderButtonSkeleton,
  TableSkeleton,
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
