import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AccountsView } from "~/components/accounts/accounts-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounts");

  return { title: t("title") };
}

export default function AccountsPage() {
  return <AccountsView />;
}
