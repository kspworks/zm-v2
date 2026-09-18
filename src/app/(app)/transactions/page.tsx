import { getTranslations } from "next-intl/server";

import { PageHeader } from "~/components/app/page-header";

export default async function TransactionsPage() {
  const t = await getTranslations("nav");

  return <PageHeader title={t("transactions")} />;
}
