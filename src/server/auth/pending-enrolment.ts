import { and, eq, gt } from "drizzle-orm";
import { Effect } from "effect";
import QRCode from "qrcode";

import {
  decryptValue,
  encryptValue,
  totpMatches,
} from "~/server/auth/two-factor";
import { query } from "~/server/db/database";
import { verifications } from "~/server/db/schema";
import { now } from "~/server/lib/clock";
import { generateTotpSecret, totpManualKey, totpUri } from "~/server/lib/totp";

const TTL_MS = 30 * 60_000;

/** The QR code an authenticator app scans, as a data URL */
export const totpQrDataUrl = (secret: string, email: string) =>
  Effect.promise(() =>
    QRCode.toDataURL(totpUri(secret, email), { margin: 1, width: 240 }),
  );

/**
 * A new authenticator waiting for its first code: the secret is kept
 * (encrypted) until confirmed, so switching only happens once the user
 * proves the new app works.
 */
export const startPendingEnrolment = Effect.fn("pendingEnrolment.start")(
  function* (key: string, email: string) {
    const secret = generateTotpSecret();
    const value = yield* encryptValue(secret);
    const at = yield* now;

    yield* query((db) =>
      db.delete(verifications).where(eq(verifications.identifier, key)),
    );
    yield* query((db) =>
      db.insert(verifications).values({
        identifier: key,
        value,
        expiresAt: new Date(at.getTime() + TTL_MS),
      }),
    );

    return {
      qrDataUrl: yield* totpQrDataUrl(secret, email),
      manualKey: totpManualKey(secret),
    };
  },
);

/** The pending secret if `code` matches it (the row is consumed), else null */
export const confirmPendingEnrolment = Effect.fn("pendingEnrolment.confirm")(
  function* (key: string, code: string) {
    const at = yield* now;
    const [row] = yield* query((db) =>
      db
        .select()
        .from(verifications)
        .where(
          and(
            eq(verifications.identifier, key),
            gt(verifications.expiresAt, at),
          ),
        )
        .for("update"),
    );

    if (!row) {
      return null;
    }

    const secret = yield* decryptValue(row.value);

    if (!(yield* totpMatches(secret, code))) {
      return null;
    }

    yield* query((db) =>
      db.delete(verifications).where(eq(verifications.identifier, key)),
    );

    return secret;
  },
);
