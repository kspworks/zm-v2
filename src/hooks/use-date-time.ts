"use client";

import { useLocale, useTimeZone } from "next-intl";

import type { Locale } from "~/i18n/config";
import { formatDateTime } from "~/lib/dates";

/** Formats a moment in the app's time zone and the reader's locale */
export const useDateTime = () => {
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone() ?? "UTC";

  return (instant: Date) => formatDateTime(instant, locale, timeZone);
};
