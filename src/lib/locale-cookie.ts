import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from "~/i18n/config";

/** Client-side: remembers the UI locale for a year (read by src/i18n/request.ts) */
export const writeLocaleCookie = (locale: Locale): void => {
  // biome-ignore lint/suspicious/noDocumentCookie: a plain first-party preference cookie
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
};

export const readLocaleCookie = (): string | undefined =>
  document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === LOCALE_COOKIE)?.[1];
