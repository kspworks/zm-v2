"use client";

import { useTranslations } from "next-intl";

import { FieldError } from "~/components/ui/field";
import { isErrorKey } from "~/lib/error-keys";

/** A field error that translates the app's own message keys */
export function FormError({
  error,
}: {
  error?: { message?: string } | undefined;
}) {
  const t = useTranslations("errors");

  if (!error?.message) {
    return null;
  }

  const message = isErrorKey(error.message) ? t(error.message) : error.message;

  return <FieldError errors={[{ message }]} />;
}
