import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ComparisonView } from "~/components/reports/comparison-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports");

  return { title: t("comparison") };
}

export default function ReportsComparePage() {
  return <ComparisonView />;
}
