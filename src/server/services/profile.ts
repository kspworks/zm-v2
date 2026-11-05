import { eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Locale } from "~/i18n/config";
import type { CurrentUser } from "~/server/api/trpc";
import { query } from "~/server/db/database";
import { users } from "~/server/db/schema";
import { AppConfig } from "~/server/effect/app-config";

/** The signed-in user plus the build info admins see in the user menu */
export const profileOf = Effect.fn("profile.of")(function* (user: CurrentUser) {
  const config = yield* AppConfig;

  return {
    ...user,
    build:
      user.role === "admin"
        ? { id: config.buildId ?? null, env: config.nodeEnv }
        : null,
    isDev: config.isDev,
  };
});

/** Stores the UI locale, which emails and seeded names are rendered in */
export const setLocale = Effect.fn("profile.setLocale")(function* (
  userId: string,
  locale: Locale,
) {
  yield* query((db) =>
    db.update(users).set({ locale }).where(eq(users.id, userId)),
  );

  return { locale };
});
