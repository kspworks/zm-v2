import { hashPassword as scryptHash } from "better-auth/crypto";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import { decryptValue, totpMatches } from "~/server/auth/two-factor";
import { query } from "~/server/db/database";
import { authAccounts, twoFactors, users } from "~/server/db/schema";
import { AppConfig } from "~/server/effect/app-config";
import { Mailer } from "~/server/effect/mailer";
import { betterAuthTotp, DEV_OTP, LEGACY_PREFIX } from "~/server/lib/totp";
import { passwordResetEmail } from "~/server/mail/templates";

/*
 * The logic behind ZM's better-auth hooks, as effects. `~/server/auth` runs
 * them with runServer and turns their answers into better-auth's APIErrors.
 */

/**
 * The code better-auth should verify instead of the one typed: the dev
 * "111111", and codes for v1-migrated base32 secrets (stored as "b32:…"),
 * become the current code of the stored secret. Null leaves the code as is.
 */
export const translateTotpCode = Effect.fn("authHooks.translateTotpCode")(
  function* (userId: string, code: string) {
    const [row] = yield* query((db) =>
      db
        .select({ secret: twoFactors.secret })
        .from(twoFactors)
        .where(eq(twoFactors.userId, userId)),
    );

    if (!row) {
      return null;
    }

    const secret = yield* decryptValue(row.secret);
    const { isDev } = yield* AppConfig;
    const legacy = secret.startsWith(LEGACY_PREFIX);

    if (
      (isDev && code === DEV_OTP) ||
      (legacy && (yield* totpMatches(secret, code)))
    ) {
      return betterAuthTotp(secret);
    }

    return null;
  },
);

/**
 * v1 passwords are bcrypt: after a correct one, store scrypt instead. No
 * transaction: the write is one statement, and two sign-ins racing here both
 * store a valid hash of the same password.
 */
export const rehashLegacyPassword = Effect.fn("authHooks.rehashLegacyPassword")(
  function* (email: string, password: string) {
    const [credential] = yield* query((db) =>
      db
        .select({ id: authAccounts.id, hash: authAccounts.password })
        .from(authAccounts)
        .innerJoin(users, eq(users.id, authAccounts.userId))
        .where(
          and(
            eq(users.email, email),
            eq(authAccounts.providerId, "credential"),
          ),
        ),
    );

    if (!credential?.hash?.startsWith("$2")) {
      return;
    }

    const hash = yield* Effect.promise(() => scryptHash(password));

    yield* query((db) =>
      db
        .update(authAccounts)
        .set({ password: hash })
        .where(eq(authAccounts.id, credential.id)),
    );
  },
);

/** Sessions are only created for users that are not soft-deleted */
export const isLiveUser = Effect.fn("authHooks.isLiveUser")(function* (
  userId: string,
) {
  const user = yield* query((db) =>
    db.query.users.findFirst({
      columns: { id: true },
      where: and(eq(users.id, userId), isNull(users.deletedAt)),
    }),
  );

  return user !== undefined;
});

/**
 * Mails a password-reset link in the user's stored locale. Without SMTP it
 * does nothing: the answer is the same either way, so addresses can't be
 * enumerated.
 */
export const sendPasswordReset = Effect.fn("authHooks.sendPasswordReset")(
  function* (
    user: { email: string; name: string; locale?: string },
    url: string,
  ) {
    const mailer = yield* Mailer;

    if (!mailer.configured) {
      return;
    }

    const locale = user.locale === "en" ? "en" : "uk";
    const mail = yield* Effect.promise(() =>
      passwordResetEmail(locale, { name: user.name, url }),
    );

    yield* mailer.send({ to: user.email, ...mail });
  },
);
