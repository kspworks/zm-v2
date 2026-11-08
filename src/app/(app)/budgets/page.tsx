import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { BudgetsView } from "~/components/budgets/budgets-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("budgets");

  return { title: t("title") };
}

export default function BudgetsPage() {
  return <BudgetsView />;
}
