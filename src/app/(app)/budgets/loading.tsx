import { useTranslations } from "next-intl";

import {
  BudgetListSkeleton,
  HeaderButtonSkeleton,
  NarrowPageSkeleton,
} from "~/components/app/skeletons";

export default function Loading() {
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
