import { useTranslations } from "next-intl";

import {
  CategoryListSkeleton,
  HeaderButtonSkeleton,
  NarrowPageSkeleton,
} from "~/components/app/skeletons";

export default function Loading() {
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
