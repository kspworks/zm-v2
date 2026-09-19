/**
 * Shared by playwright.config.ts, the database script and the specs. Kept out
 * of the config itself so the tsx-run database script doesn't pull in
 * Playwright.
 */

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);

export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// the Vitest postgres from docker-compose.test.yml; CI points it at its service
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://zm:zm@127.0.0.1:5433/zm_e2e?idle_timeout=2";

/** Signed-in state and credentials written by auth.setup.ts */
export const AUTH_STATE = "e2e/.auth/admin.json";
export const AUTH_CREDENTIALS = "e2e/.auth/admin-credentials.json";
