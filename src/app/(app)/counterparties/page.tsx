import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { CounterpartiesView } from "~/components/counterparties/counterparties-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("counterparties");

  return { title: t("title") };
}

export default function CounterpartiesPage() {
  return <CounterpartiesView />;
}
