import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ReportsView } from "~/components/reports/reports-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports");

  return { title: t("title") };
}

export default function ReportsPage() {
  return <ReportsView />;
}
