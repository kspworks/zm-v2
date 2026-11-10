import { useTranslations } from "next-intl";

import {
  ItemListSkeleton,
  NarrowPageSkeleton,
} from "~/components/app/skeletons";

export default function Loading() {
  const t = useTranslations("counterparties");

  return (
    <NarrowPageSkeleton title={t("title")}>
      <p className="text-muted-foreground text-sm">{t("hint")}</p>
      <ItemListSkeleton />
    </NarrowPageSkeleton>
  );
}
