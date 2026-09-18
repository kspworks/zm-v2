import type { Locale } from "~/i18n/config";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";

/**
 * The tRPC context is `{ db, userId, locale, origin }`, so tests hand the
 * caller one directly instead of going through cookies. Protected procedures
 * still re-read the user from the database, exactly as in production.
 */
export const callerFor = (
  user: { id: string } | null,
  { locale = "en" as Locale } = {},
) =>
  createCaller({
    db,
    userId: user?.id ?? null,
    locale,
    origin: "http://localhost:3000",
  });

export const anonymousCaller = (options?: { locale?: Locale }) =>
  callerFor(null, options);
