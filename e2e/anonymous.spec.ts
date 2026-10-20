import type { Page } from "@playwright/test";

import {
  expect,
  readCredentials,
  resetRateLimits,
  test,
  totp,
} from "./helpers";

/**
 * Signed-out visitors: the proxy gate, the two-step sign-in against the admin
 * that auth.setup.ts registered, and the one-shot admin invite.
 */

test.beforeEach(resetRateLimits);

const submitCredentials = async (
  page: Page,
  email: string,
  password: string,
) => {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};

test("the root and protected pages send you to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/login/);
  await expect(page.getByText("Welcome back to ZM")).toBeVisible();
  // auth.setup.ts registered the admin, so the bootstrap link is gone
  await expect(
    page.getByRole("link", {
      name: "No account yet? Set up the administrator",
    }),
  ).toHaveCount(0);

  // through the /reports redirect, which keeps the query string
  await page.goto("/reports?period=month");
  await expect(page).toHaveURL(/\/auth\/login\?callbackUrl=/);
  expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe(
    "/reports/map?period=month",
  );
});

test("signs in with password and authenticator code", async ({ page }) => {
  const credentials = readCredentials();

  await page.goto("/auth/login?callbackUrl=%2Faccounts");
  await submitCredentials(page, credentials.email, credentials.password);

  await expect(page.getByText("Two-factor authentication")).toBeVisible();
  // a full code submits on its own
  await page.getByLabel("Code").fill(totp(credentials.manualKey));

  await expect(page).toHaveURL(/\/accounts$/);
  await expect(
    page.getByRole("heading", { name: "Accounts", level: 1 }),
  ).toBeVisible();
});

test.describe("rejections", () => {
  test.use({ allowedErrors: [/status of 401/] });

  test("a wrong password is refused", async ({ page }) => {
    const credentials = readCredentials();

    await page.goto("/auth/login");
    await submitCredentials(page, credentials.email, "not-the-password");

    await expect(page.getByText("Wrong email, password or code")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("a wrong authenticator code is refused", async ({ page }) => {
    const credentials = readCredentials();

    await page.goto("/auth/login");
    await submitCredentials(page, credentials.email, credentials.password);
    await page.getByLabel("Code").fill("000000");

    await expect(page.getByText("Wrong email, password or code")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByLabel("Code")).toHaveValue("");
  });

  test("a wrong backup code is refused", async ({ page }) => {
    const credentials = readCredentials();

    await page.goto("/auth/login");
    await submitCredentials(page, credentials.email, credentials.password);
    await page
      .getByRole("button", {
        name: "Lost your authenticator? Use a backup code",
      })
      .click();
    await page.getByLabel("Backup code").fill("wrong-code1");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByText("Wrong email, password or code")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});

test("the code inputs only submit a plausible code", async ({ page }) => {
  const credentials = readCredentials();

  await page.goto("/auth/login");
  await submitCredentials(page, credentials.email, credentials.password);

  // the authenticator code takes digits only
  await page.getByLabel("Code").pressSequentially("1a2b");
  await expect(page.getByLabel("Code")).toHaveValue("12");

  await page
    .getByRole("button", { name: "Lost your authenticator? Use a backup code" })
    .click();
  const backup = page.getByLabel("Backup code");
  const verify = page.getByRole("button", { name: "Verify" });

  await expect(verify).toBeDisabled();
  await backup.fill("abc");
  await expect(verify).toBeDisabled();
  await backup.fill("      ");
  await expect(verify).toBeDisabled();
  await backup.fill("abcdef");
  await expect(verify).toBeEnabled();
});

test("a backup code signs in and points at re-enrolment", async ({ page }) => {
  const credentials = readCredentials();
  // the setup spent none; each spec run starts from a fresh database
  const [code] = credentials.backupCodes;

  await page.goto("/auth/login");
  await submitCredentials(page, credentials.email, credentials.password);
  await page
    .getByRole("button", { name: "Lost your authenticator? Use a backup code" })
    .click();
  // pasted with stray spaces, which the form trims
  await page.getByLabel("Backup code").fill(`  ${code}  `);
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page).toHaveURL(/\/settings\?reenrol=1$/);
});

test("the admin invite closes once an admin exists", async ({ page }) => {
  await page.goto("/auth/register/invite?id=admin");

  await expect(
    page.getByText("This invite link is invalid or has already been used."),
  ).toBeVisible();
});
