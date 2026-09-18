import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { auth } from "~/server/auth";
import type { DbOrTx } from "~/server/db";
import { twoFactors, users } from "~/server/db/schema";
import { randomString } from "~/server/lib/ids";
import { verifyTotp } from "~/server/lib/totp";

/**
 * Reads and writes the twoFactor row exactly the way better-auth's plugin
 * does (symmetric encryption keyed by BETTER_AUTH_SECRET, backup codes as an
 * encrypted JSON array), so its sign-in endpoints accept what we store.
 */

const secretKey = async () => (await auth.$context).secretConfig;

export const encryptValue = async (data: string): Promise<string> =>
  symmetricEncrypt({ key: await secretKey(), data });

export const decryptValue = async (data: string): Promise<string> =>
  symmetricDecrypt({ key: await secretKey(), data });

/** Same shape as better-auth's generator: 10 codes like "aB3dE-fG5hJ" */
export const generateBackupCodes = (amount = 10): string[] =>
  Array.from({ length: amount }, () => {
    const code = randomString(10);

    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });

export const hashPassword = async (password: string): Promise<string> =>
  (await auth.$context).password.hash(password);

export const verifyPasswordHash = async (
  hash: string,
  password: string,
): Promise<boolean> =>
  (await auth.$context).password.verify({ hash, password });

/**
 * Replaces the user's authenticator with `secret`, generates fresh backup
 * codes (the old ones stop working) and marks 2FA enabled.
 */
export const enrolTwoFactor = async (
  tx: DbOrTx,
  userId: string,
  secret: string,
): Promise<string[]> => {
  const backupCodes = generateBackupCodes();
  const values = {
    secret: await encryptValue(secret),
    backupCodes: await encryptValue(JSON.stringify(backupCodes)),
    verified: true,
    failedVerificationCount: 0,
    lockedUntil: null,
  };

  await tx.delete(twoFactors).where(eq(twoFactors.userId, userId));
  await tx.insert(twoFactors).values({ userId, ...values });
  await tx
    .update(users)
    .set({ twoFactorEnabled: true })
    .where(eq(users.id, userId));

  return backupCodes;
};

export const regenerateBackupCodes = async (
  tx: DbOrTx,
  userId: string,
): Promise<string[]> => {
  const backupCodes = generateBackupCodes();

  await tx
    .update(twoFactors)
    .set({ backupCodes: await encryptValue(JSON.stringify(backupCodes)) })
    .where(eq(twoFactors.userId, userId));

  return backupCodes;
};

/**
 * Checks a TOTP code, or (when allowed) a backup code, which is then consumed.
 * Backup codes are compared case-sensitively, as better-auth does.
 */
export const verifySecondFactor = async (
  tx: DbOrTx,
  userId: string,
  code: string,
  { allowBackupCode }: { allowBackupCode: boolean },
): Promise<boolean> => {
  const [row] = await tx
    .select()
    .from(twoFactors)
    .where(eq(twoFactors.userId, userId))
    .for("update");

  if (!row) {
    return false;
  }

  const trimmed = code.trim();

  if (verifyTotp(await decryptValue(row.secret), trimmed)) {
    return true;
  }

  if (!allowBackupCode) {
    return false;
  }

  const codes = JSON.parse(await decryptValue(row.backupCodes)) as string[];

  if (!codes.includes(trimmed)) {
    return false;
  }

  await tx
    .update(twoFactors)
    .set({
      backupCodes: await encryptValue(
        JSON.stringify(codes.filter((candidate) => candidate !== trimmed)),
      ),
    })
    .where(eq(twoFactors.id, row.id));

  return true;
};
