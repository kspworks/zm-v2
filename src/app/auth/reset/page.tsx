import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ResetPasswordForm } from "~/components/auth/reset-password-form";
import { mailConfig } from "~/server/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgot");

  return { title: t("title") };
}

/** Forgot password: only offered when SMTP is configured */
export default async function ResetPage({
  searchParams,
}: PageProps<"/auth/reset">) {
  if (!mailConfig()) {
    notFound();
  }

  const { token, error } = await searchParams;

  return (
    <ResetPasswordForm
      token={typeof token === "string" ? token : null}
      invalid={typeof error === "string"}
    />
  );
}
