import type { Locale } from "~/i18n/config";
import type en from "~/messages/en.json";

export type Messages = typeof en;

export const loadMessages = async (locale: Locale): Promise<Messages> => {
  // static imports per locale, so the bundler traces both files
  if (locale === "en") {
    return (await import("~/messages/en.json")).default;
  }

  return (await import("~/messages/uk.json")).default;
};
