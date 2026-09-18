import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LoginForm } from "~/components/auth/login-form";
import { sanitizeAuthError, sanitizeCallbackUrl } from "~/lib/auth-routing";
import { getCurrentUser } from "~/server/auth/session";
import { mailConfig } from "~/server/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");

  return { title: t("title") };
}

export default async function LoginPage({
  searchParams,
}: PageProps<"/auth/login">) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const callbackUrl = sanitizeCallbackUrl(first(params.callbackUrl));

  if (await getCurrentUser()) {
    redirect(callbackUrl);
  }

  return (
    <LoginForm
      callbackUrl={callbackUrl}
      initialError={sanitizeAuthError(first(params.error))}
      canResetPassword={mailConfig() !== null}
    />
  );
}
