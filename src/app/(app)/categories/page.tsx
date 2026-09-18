import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { CategoriesView } from "~/components/categories/categories-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("categories");

  return { title: t("title") };
}

export default function CategoriesPage() {
  return <CategoriesView />;
}
