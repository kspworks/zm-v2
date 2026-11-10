import { useTranslations } from "next-intl";

import {
  NarrowPageSkeleton,
  SettingsCardSkeleton,
  TabsSkeleton,
} from "~/components/app/skeletons";

export default function Loading() {
  const t = useTranslations("settings");

  return (
    <NarrowPageSkeleton title={t("title")}>
      <TabsSkeleton className="w-full" />
      <SettingsCardSkeleton />
      <SettingsCardSkeleton />
    </NarrowPageSkeleton>
  );
}
