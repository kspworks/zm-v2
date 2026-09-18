import { randomBytes } from "node:crypto";

import { createId } from "@paralleldrive/cuid2";

export const newId = (): string => createId();

const ALPHANUMERIC =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Unbiased random alphanumeric string (rejection sampling over random bytes) */
export const randomString = (length: number): string => {
  let result = "";

  while (result.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // 248 = 62 * 4, the largest multiple of the alphabet size below 256
      if (byte < 248 && result.length < length) {
        result += ALPHANUMERIC[byte % ALPHANUMERIC.length];
      }
    }
  }

  return result;
};
