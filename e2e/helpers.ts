import { readFileSync } from "node:fs";

import { test as base, expect, type Page } from "@playwright/test";
import { Secret, TOTP } from "otpauth";
import postgres from "postgres";

import { AUTH_CREDENTIALS, E2E_DATABASE_URL } from "./env";

export type Credentials = {
  name: string;
  email: string;
  password: string;
  /** The base32 key the register wizard shows for manual entry */
  manualKey: string;
  backupCodes: string[];
};

export const readCredentials = (): Credentials =>
  JSON.parse(readFileSync(AUTH_CREDENTIALS, "utf8"));

/** What an authenticator app would show right now for the manual key */
export const totp = (manualKey: string): string =>
  new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(manualKey.replace(/\s+/g, "")),
  }).generate();

/**
 * Clears the sign-in rate limits. better-auth allows 3 sign-ins per 10 s per
 * IP on its own (auth_rate_limits), on top of the app's per-email limit
 * (rate_limits); every browser here shares 127.0.0.1, so on a fast machine
 * the suite's sign-ins would trip it. Call before each test that signs in.
 */
export const resetRateLimits = async () => {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => false });

  try {
    await sql`TRUNCATE auth_rate_limits, rate_limits`;
  } finally {
    await sql.end({ timeout: 5 });
  }
};

/** A layout that is too wide shows up as a page that scrolls sideways */
export const expectNoHorizontalScroll = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
};

/**
 * Fails any test during which the page throws or logs a console error:
 * hydration mismatches and broken client bundles after an upgrade tend to
 * show up here long before anything is visibly wrong.
 */
export const test = base.extend<{
  /** Console errors a test provokes on purpose, e.g. a 401 from a bad login */
  allowedErrors: RegExp[];
  pageErrors: string[];
}>({
  allowedErrors: [[], { option: true }],
  pageErrors: [
    async ({ page, allowedErrors }, use) => {
      const errors: string[] = [];

      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") {
          errors.push(message.text());
        }
      });

      await use(errors);

      const unexpected = errors.filter(
        (error) => !allowedErrors.some((pattern) => pattern.test(error)),
      );

      expect(unexpected, "errors in the browser console").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
