import { useTranslations } from "next-intl";

import {
  HeaderButtonSkeleton,
  ItemListSkeleton,
  NarrowPageSkeleton,
} from "~/components/app/skeletons";

export default function Loading() {
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
