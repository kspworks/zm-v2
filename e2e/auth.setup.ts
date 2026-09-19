import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { AUTH_CREDENTIALS, AUTH_STATE } from "./env";
import { type Credentials, expect, test as setup, totp } from "./helpers";

/**
 * Bootstraps the administrator through the real invite wizard rather than
 * writing rows directly, so the signed-in state every other spec depends on
 * is itself proof that the invite check, TOTP enrolment, backup codes, the
 * sign-in ticket and the (app) layout's gate all work together.
 */
setup("bootstrap the administrator and stay signed in", async ({ page }) => {
  const credentials: Credentials = {
    name: "Test Admin",
    email: "admin@example.com",
    password: "correct-horse-battery",
    manualKey: "",
    backupCodes: [],
  };

  await page.goto("/auth/register/invite?id=admin");
  await expect(
    page.getByText("Create the administrator account"),
  ).toBeVisible();

  await setup.step("details", async () => {
    await page.getByLabel("Name").fill(credentials.name);
    await page.getByLabel("Email").fill(credentials.email);
    await page.getByLabel("Password").fill(credentials.password);
    await page.getByRole("button", { name: "Next" }).click();
  });

  await setup.step("enrol the authenticator", async () => {
    await expect(page.getByAltText("Scan the QR code")).toBeVisible();
    credentials.manualKey = (
      await page.locator("code").first().innerText()
    ).replace(/\s+/g, "");
    expect(credentials.manualKey).toMatch(/^[A-Z2-7]+$/);

    // a full code submits on its own
    await page.getByLabel("Code").fill(totp(credentials.manualKey));
  });

  await setup.step("save the backup codes", async () => {
    await expect(page.getByText("Save your backup codes")).toBeVisible();
    credentials.backupCodes = (await page.locator("ul li").allInnerTexts())
      .map((text) => text.trim())
      .filter(Boolean);
    expect(credentials.backupCodes.length).toBeGreaterThan(0);

    await page.getByLabel("I have saved my backup codes").check();
    await page.getByRole("button", { name: "Go to ZM" }).click();
  });

  await expect(page).toHaveURL(/\/transactions$/);
  await expect(
    page.getByRole("heading", { name: "Transactions", level: 1 }),
  ).toBeVisible();

  mkdirSync(dirname(AUTH_CREDENTIALS), { recursive: true });
  writeFileSync(AUTH_CREDENTIALS, JSON.stringify(credentials, null, 2));
  await page.context().storageState({ path: AUTH_STATE });
});
