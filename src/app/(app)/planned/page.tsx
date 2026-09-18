import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PlannedView } from "~/components/planned/planned-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("planned");

  return { title: t("title") };
}

export default function PlannedPage() {
  return <PlannedView />;
}
