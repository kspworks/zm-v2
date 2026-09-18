"use client";

import { useEffect } from "react";

import type { Locale } from "~/i18n/config";
import { readLocaleCookie, writeLocaleCookie } from "~/lib/locale-cookie";

/** After sign-in the profile wins: rewrite a disagreeing locale cookie */
export function LocaleCookieSync({ profileLocale }: { profileLocale: Locale }) {
  useEffect(() => {
    if (readLocaleCookie() !== profileLocale) {
      writeLocaleCookie(profileLocale);
    }
  }, [profileLocale]);

  return null;
}
