import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RecoverForm } from "~/components/auth/recover-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("recover");

  return { title: t("title") };
}

export default async function RecoverPage({
  searchParams,
}: PageProps<"/auth/recover">) {
  const { token } = await searchParams;

  return <RecoverForm token={typeof token === "string" ? token : ""} />;
}
