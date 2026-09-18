import { createHash, timingSafeEqual } from "node:crypto";

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** Constant-time string comparison that doesn't leak the length through timing */
export const safeEqual = (a: string, b: string): boolean => {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();

  return timingSafeEqual(left, right) && a.length === b.length;
};
