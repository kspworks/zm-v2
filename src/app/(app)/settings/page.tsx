import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SettingsView } from "~/components/settings/settings-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");

  return { title: t("title") };
}

export default async function SettingsPage({
  searchParams,
}: PageProps<"/settings">) {
  const { reenrol } = await searchParams;

  return <SettingsView reenrolPrompt={reenrol === "1"} />;
}
