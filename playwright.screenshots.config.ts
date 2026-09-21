import { defineConfig, devices } from "@playwright/test";
import { AUTH_STATE } from "./e2e/env";
import base from "./playwright.config";

/**
 * `pnpm screenshots`: the README images in docs/screenshots/. Same server and
 * throwaway database as the browser tests, the same admin bootstrap, then a
 * demo seed instead of the specs.
 */
export default defineConfig({
  ...base,
  retries: 0,
  reporter: [["list"]],
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "demo",
      testMatch: /demo\.setup\.ts$/,
      dependencies: ["setup"],
      use: { storageState: AUTH_STATE },
    },
    {
      name: "desktop",
      testMatch: /screenshots\.spec\.ts$/,
      dependencies: ["demo"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: AUTH_STATE,
      },
    },
    {
      name: "mobile",
      testMatch: /screenshots\.spec\.ts$/,
      dependencies: ["demo"],
      use: { ...devices["Pixel 7"], storageState: AUTH_STATE },
    },
  ],
});
