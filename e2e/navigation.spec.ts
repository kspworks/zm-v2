import { expect, test } from "./helpers";

/**
 * Every signed-in page, reached the way a user would: through the sidebar.
 * Mostly a tripwire for upgrades - each page must render its header and log
 * nothing to the console (the helpers' fixture checks the console).
 */

const PAGES = [
  "Transactions",
  "Planned",
  "Reports",
  "Accounts",
  "Categories",
  "Counterparties",
  "Import",
  // admin-only, and the setup user is the bootstrap admin
  "Users",
];

test("the sidebar reaches every page", async ({ page }) => {
  await page.goto("/transactions");
  const sidebar = page.locator("[data-slot='sidebar']");

  for (const name of PAGES) {
    await test.step(name, async () => {
      await sidebar.getByRole("link", { name, exact: true }).click();
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    });
  }
});

test("settings are in the user menu", async ({ page }) => {
  await page.goto("/transactions");

  await page.getByRole("button", { name: /Test Admin/ }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();

  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
});

test("switches the language and back", async ({ page }) => {
  const switchTo = async (menu: string, language: string) => {
    await page.getByRole("button", { name: /Test Admin/ }).click();
    await page.getByRole("menuitem", { name: menu }).click();
    await page.getByRole("menuitemradio", { name: language }).click();
  };

  await page.goto("/transactions");

  await switchTo("Language", "Українська");
  await expect(
    page.getByRole("heading", { name: "Транзакції", level: 1 }),
  ).toBeVisible();

  // the profile keeps it across a reload, not just the cookie
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Транзакції", level: 1 }),
  ).toBeVisible();

  // back to English, which the other specs read
  await switchTo("Мова", "English");
  await expect(
    page.getByRole("heading", { name: "Transactions", level: 1 }),
  ).toBeVisible();
});

test.describe("unknown paths", () => {
  test.use({ allowedErrors: [/status of 404/] });

  test("show the not-found page", async ({ page }) => {
    const response = await page.goto("/no-such-page");

    expect(response?.status()).toBe(404);
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});
