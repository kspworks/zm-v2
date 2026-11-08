import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { auth } from "~/server/auth";
import { query } from "~/server/db/database";
import { twoFactors, users } from "~/server/db/schema";
import { AppConfig } from "~/server/effect/app-config";
import { now } from "~/server/lib/clock";
import { randomString } from "~/server/lib/ids";
import { verifyTotp } from "~/server/lib/totp";

/**
 * Reads and writes the twoFactor row exactly the way better-auth's plugin
 * does (symmetric encryption keyed by BETTER_AUTH_SECRET, backup codes as an
 * encrypted JSON array), so its sign-in endpoints accept what we store.
 */

/**
 * The slice of better-auth's context used here. Typed by hand: inferring it
 * from `auth` would be circular, since `auth`'s hooks use this module.
 */
type AuthCrypto = {
  secretConfig: Parameters<typeof symmetricEncrypt>[0]["key"];
  password: {
    hash(password: string): Promise<string>;
    verify(input: { hash: string; password: string }): Promise<boolean>;
  };
};

const authContext: Effect.Effect<AuthCrypto> = Effect.promise(
  () => auth.$context,
);

export const encryptValue = Effect.fnUntraced(function* (data: string) {
  const { secretConfig } = yield* authContext;

  return yield* Effect.promise(() =>
    symmetricEncrypt({ key: secretConfig, data }),
  );
});

export const decryptValue = Effect.fnUntraced(function* (data: string) {
  const { secretConfig } = yield* authContext;

  return yield* Effect.promise(() =>
    symmetricDecrypt({ key: secretConfig, data }),
  );
});

/** Same shape as better-auth's generator: 10 codes like "aB3dE-fG5hJ" */
export const generateBackupCodes = (amount = 10): string[] =>
  Array.from({ length: amount }, () => {
    const code = randomString(10);

    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });

export const hashPassword = Effect.fnUntraced(function* (password: string) {
  const { password: hasher } = yield* authContext;

  return yield* Effect.promise(() => hasher.hash(password));
});

export const verifyPasswordHash = Effect.fnUntraced(function* (
  hash: string,
  password: string,
) {
  const { password: hasher } = yield* authContext;

  return yield* Effect.promise(() => hasher.verify({ hash, password }));
});

/**
 * Whether `code` is a valid TOTP for `secret` right now (Clock time); in
 * development the literal DEV_OTP passes too
 */
export const totpMatches = Effect.fnUntraced(function* (
  secret: string,
  code: string,
) {
  const at = yield* now;
  const { isDev } = yield* AppConfig;

  return verifyTotp(secret, code, at.getTime(), isDev);
});

/**
 * Replaces the user's authenticator with `secret`, generates fresh backup
 * codes (the old ones stop working) and marks 2FA enabled. Runs inside the
 * caller's transaction.
 */
export const enrolTwoFactor = Effect.fn("twoFactor.enrol")(function* (
  userId: string,
  secret: string,
) {
  const backupCodes = generateBackupCodes();
  const values = {
    secret: yield* encryptValue(secret),
    backupCodes: yield* encryptValue(JSON.stringify(backupCodes)),
    verified: true,
    failedVerificationCount: 0,
    lockedUntil: null,
  };

  yield* query((db) =>
    db.delete(twoFactors).where(eq(twoFactors.userId, userId)),
  );
  yield* query((db) => db.insert(twoFactors).values({ userId, ...values }));
  yield* query((db) =>
    db
      .update(users)
      .set({ twoFactorEnabled: true })
      .where(eq(users.id, userId)),
  );

  return backupCodes;
});

export const regenerateBackupCodes = Effect.fn("twoFactor.regenerateBackup")(
  function* (userId: string) {
    const backupCodes = generateBackupCodes();
    const encrypted = yield* encryptValue(JSON.stringify(backupCodes));

    yield* query((db) =>
      db
        .update(twoFactors)
        .set({ backupCodes: encrypted })
        .where(eq(twoFactors.userId, userId)),
    );

    return backupCodes;
  },
);

/**
 * Checks a TOTP code, or (when allowed) a backup code, which is then consumed.
 * Backup codes are compared case-sensitively, as better-auth does. Locks the
 * row, so run it inside a transaction.
 */
export const verifySecondFactor = Effect.fn("twoFactor.verify")(function* (
  userId: string,
  code: string,
  { allowBackupCode }: { allowBackupCode: boolean },
) {
  const [row] = yield* query((db) =>
    db
      .select()
      .from(twoFactors)
      .where(eq(twoFactors.userId, userId))
      .for("update"),
  );

  if (!row) {
    return false;
  }

  const trimmed = code.trim();

  if (yield* totpMatches(yield* decryptValue(row.secret), trimmed)) {
    return true;
  }

  if (!allowBackupCode) {
    return false;
  }

  const codes = JSON.parse(yield* decryptValue(row.backupCodes)) as string[];

  if (!codes.includes(trimmed)) {
    return false;
  }

  const remaining = yield* encryptValue(
    JSON.stringify(codes.filter((candidate) => candidate !== trimmed)),
  );

  yield* query((db) =>
    db
      .update(twoFactors)
      .set({ backupCodes: remaining })
      .where(eq(twoFactors.id, row.id)),
  );

  return true;
});
