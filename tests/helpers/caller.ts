import type { Locale } from "~/i18n/config";
import { createCaller } from "~/server/api/root";

/**
 * The tRPC context is `{ userId, locale }`, so tests hand the
 * caller one directly instead of going through cookies. Protected procedures
 * still re-read the user from the database, exactly as in production.
 */
export const callerFor = (
  user: { id: string } | null,
  { locale = "en" as Locale } = {},
) =>
  createCaller({
    userId: user?.id ?? null,
    locale,
  });

export const anonymousCaller = (options?: { locale?: Locale }) =>
  callerFor(null, options);
