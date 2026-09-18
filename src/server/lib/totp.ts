import { Secret, TOTP } from "otpauth";

import { isDev } from "~/server/config";
import { randomString } from "~/server/lib/ids";

/**
 * TOTP with better-auth's conventions: the stored secret is a plain string and
 * its UTF-8 bytes are the HMAC key (authenticator apps get the base32 form),
 * SHA1, 6 digits, 30 s. A secret generated here can be copied verbatim into
 * better-auth's twoFactor row.
 */
export const TOTP_ISSUER = "ZM";

/** The literal accepted in development only, so local sign-ins need no phone */
export const DEV_OTP = "111111";

export const generateTotpSecret = (): string => randomString(32);

/**
 * Secrets migrated from v1 were base32 of random bytes, which aren't valid
 * UTF-8; they are stored as "b32:<base32>" and keyed by the decoded bytes.
 */
export const LEGACY_PREFIX = "b32:";

const keyOf = (secret: string): Secret =>
  secret.startsWith(LEGACY_PREFIX)
    ? Secret.fromBase32(secret.slice(LEGACY_PREFIX.length))
    : new Secret({
        buffer: new TextEncoder().encode(secret).buffer as ArrayBuffer,
      });

const totpFor = (secret: string, label = "") =>
  new TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: keyOf(secret),
  });

/**
 * The code better-auth expects for a stored secret: it always keys HMAC with
 * the string's UTF-8 bytes, legacy prefix included.
 */
export const betterAuthTotp = (storedSecret: string): string =>
  new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: new Secret({
      buffer: new TextEncoder().encode(storedSecret).buffer as ArrayBuffer,
    }),
  }).generate();

export const totpUri = (secret: string, email: string): string =>
  totpFor(secret, email).toString();

/** The base32 form, for typing the secret into an app by hand */
export const totpManualKey = (secret: string): string =>
  totpFor(secret).secret.base32;

export const generateTotp = (secret: string, timestamp = Date.now()): string =>
  totpFor(secret).generate({ timestamp });

/** Accepts the current step and one step either side */
export const verifyTotp = (
  secret: string,
  code: string,
  timestamp = Date.now(),
): boolean => {
  const token = code.replace(/\s+/g, "");

  if (isDev() && token === DEV_OTP) {
    return true;
  }

  if (!/^\d{6}$/.test(token)) {
    return false;
  }

  return totpFor(secret).validate({ token, timestamp, window: 1 }) !== null;
};
