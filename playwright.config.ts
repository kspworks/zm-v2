import { defineConfig, devices } from "@playwright/test";

import { AUTH_STATE, BASE_URL, E2E_DATABASE_URL, E2E_PORT } from "./e2e/env";

/**
 * Browser tests, mainly as a gate for dependency upgrades: they see what
 * Vitest structurally cannot - hydration, the proxy gate, Radix overlays under
 * real pointer events, the mobile sidebar and the standalone bundle itself.
 * So by default they run against `dist/server.js` from build:selfhosted, the
 * artifact that gets deployed.
 *
 * E2E_PREBUILT=1 serves an existing dist/ (CI builds it for the smoke test);
 * E2E_DEV=1 runs `next dev` instead, for quick iteration on the specs.
 */

const server = process.env.E2E_DEV
  ? "pnpm dev"
  : process.env.E2E_PREBUILT
    ? "node dist/server.js"
    : "pnpm build:selfhosted && node dist/server.js";

export default defineConfig({
  testDir: "./e2e",
  // one database behind the server, so specs share state and must not race
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    // the app defaults to Ukrainian; the specs read en.json
    locale: "en-US",
    timezoneId: "Europe/Kyiv",
    trace: "on-first-retry",
  },
  webServer: {
    // the database is rebuilt here rather than in a global setup, because
    // Playwright starts the server before any setup would run
    command: `pnpm test:e2e:db && ${server}`,
    url: `${BASE_URL}/auth/login`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    // said out loud rather than left to .env: Next loads the local one at build
    // and boot, and its database, mail or Sentry settings must not leak in
    env: {
      PORT: String(E2E_PORT),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: "e2e.Qm7vT2kR9xLp4WzN8cHs3JdY6bFg5Ua1",
      BETTER_AUTH_URL: BASE_URL,
      CRON_SECRET: "e2e-cron-secret-0123456789",
      APP_TIMEZONE: "Europe/Kyiv",
      TRANSACTIONS_PAGINATION_LIMIT: "50",
      MAIL_HOST: "",
      SENTRY_AUTH_TOKEN: "",
      SENTRY_ORG: "",
      SENTRY_PROJECT: "",
      NEXT_PUBLIC_SENTRY_DSN: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
  projects: [
    // registration is the fixture: bootstrapping the admin through the real
    // wizard is both what the other specs need and a journey worth testing
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "anonymous",
      testMatch: /anonymous\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop",
      testIgnore: /(anonymous|mobile|screenshots)\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], storageState: AUTH_STATE },
    },
  ],
});
