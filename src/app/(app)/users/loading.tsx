import { useTranslations } from "next-intl";

import {
  HeaderButtonSkeleton,
  ItemListSkeleton,
  NarrowPageSkeleton,
} from "~/components/app/skeletons";

export default function Loading() {
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
