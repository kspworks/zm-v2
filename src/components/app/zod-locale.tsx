"use client";

import { useLocale } from "next-intl";
import { z } from "zod";

/**
 * Localises zod's built-in validation messages to the UI locale. Runs during
 * render (before any form validates), and z.config is idempotent.
 */
export function ZodLocale() {
  const locale = useLocale();

  z.config(locale === "uk" ? z.locales.uk() : z.locales.en());

  return null;
}
