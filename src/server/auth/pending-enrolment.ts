import { and, eq, gt } from "drizzle-orm";
import QRCode from "qrcode";

import { decryptValue, encryptValue } from "~/server/auth/two-factor";
import type { DbOrTx } from "~/server/db";
import { verifications } from "~/server/db/schema";
import { now } from "~/server/lib/clock";
import {
  generateTotpSecret,
  totpManualKey,
  totpUri,
  verifyTotp,
} from "~/server/lib/totp";

const TTL_MS = 30 * 60_000;

/**
 * A new authenticator waiting for its first code: the secret is kept
 * (encrypted) until confirmed, so switching only happens once the user
 * proves the new app works.
 */
export const startPendingEnrolment = async (
  tx: DbOrTx,
  key: string,
  email: string,
) => {
  const secret = generateTotpSecret();

  await tx.delete(verifications).where(eq(verifications.identifier, key));
  await tx.insert(verifications).values({
    identifier: key,
    value: await encryptValue(secret),
    expiresAt: new Date(now().getTime() + TTL_MS),
  });

  return {
    qrDataUrl: await QRCode.toDataURL(totpUri(secret, email), {
      margin: 1,
      width: 240,
    }),
    manualKey: totpManualKey(secret),
  };
};

/** The pending secret if `code` matches it (the row is consumed), else null */
export const confirmPendingEnrolment = async (
  tx: DbOrTx,
  key: string,
  code: string,
): Promise<string | null> => {
  const [row] = await tx
    .select()
    .from(verifications)
    .where(
      and(
        eq(verifications.identifier, key),
        gt(verifications.expiresAt, now()),
      ),
    )
    .for("update");

  if (!row) {
    return null;
  }

  const secret = await decryptValue(row.value);

  if (!verifyTotp(secret, code)) {
    return null;
  }

  await tx.delete(verifications).where(eq(verifications.identifier, key));

  return secret;
};
