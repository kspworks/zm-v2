import { createTranslator } from "next-intl";

import type { Locale } from "~/i18n/config";
import { loadMessages } from "~/i18n/messages";

/**
 * A translator for rendering outside a request (seed names, the debt account
 * name, emails). Always pass the user's *stored* locale, never a guess.
 */
export const getServerTranslator = async (locale: Locale) =>
  createTranslator({ locale, messages: await loadMessages(locale) });
