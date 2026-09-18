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

const totpFor = (secret: string, label = "") =>
  new TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: new Secret({
      buffer: new TextEncoder().encode(secret).buffer as ArrayBuffer,
    }),
  });

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
