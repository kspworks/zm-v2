import {
  expect,
  expectNoHorizontalScroll,
  readCredentials,
  resetRateLimits,
  test,
  totp,
} from "./helpers";

/**
 * Phone-width layout, which only a real browser can judge. Runs under the
 * `mobile` project (a Pixel 7): the sidebar turns into a sheet behind the menu
 * button and dialogs into bottom drawers.
 */

const PAGES = [
  ["Dashboard", "/dashboard"],
  ["Transactions", "/transactions"],
  ["Planned", "/planned"],
  ["Reports", "/reports"],
  ["Accounts", "/accounts"],
  ["Categories", "/categories"],
  ["Counterparties", "/counterparties"],
  ["Import", "/import"],
  ["Users", "/users"],
] as const;

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(resetRateLimits);

  test("sign-in fits a phone screen and works", async ({ page }) => {
    const credentials = readCredentials();

    await page.goto("/auth/login");
    await expectNoHorizontalScroll(page);

    await page.getByLabel("Email").fill(credentials.email);
    await page.getByLabel("Password").fill(credentials.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Two-factor authentication")).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByLabel("Code").fill(totp(credentials.manualKey));
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

test("the menu sheet reaches every page and each one fits", async ({
  page,
}, testInfo) => {
  await page.goto("/transactions");

  // collapsed into a sheet: the links are not on screen until it opens
  await expect(
    page.getByRole("link", { name: "Accounts", exact: true }),
  ).toBeHidden();

  for (const [name, path] of PAGES) {
    await test.step(name, async () => {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("link", { name, exact: true }).click();

      // following a link closes the sheet
      await expect(sheet).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`${path}(\\?.*)?$`));
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({
        path: testInfo.outputPath(`${path.slice(1)}.png`),
        fullPage: true,
      });
    });
  }
});

test("adds a transaction from the bottom drawer", async ({ page }) => {
  await page.goto("/transactions");
  await page.getByRole("button", { name: "Add transaction" }).click();

  const drawer = page.getByRole("dialog", { name: "New transaction" });
  await expect(drawer).toBeVisible();
  await expectNoHorizontalScroll(page);

  await drawer.getByLabel("Amount").fill("42");
  await drawer.getByRole("combobox", { name: "Category" }).click();
  await page.getByPlaceholder("Search category…").fill("Pets");
  await page.getByRole("option", { name: "Pets", exact: true }).click();
  await drawer.getByLabel("Comment").fill("Cat food");

  // the drawer is taller than the phone, so the footer must scroll into reach
  const save = drawer.getByRole("button", { name: "Save" });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await save.click();
  await expect(drawer.getByLabel("Amount")).toHaveValue("");

  await drawer.getByRole("button", { name: "Close" }).first().click();
  await expect(drawer).toBeHidden();
  await expect(page.locator("main").getByText("Cat food")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("adds a subcategory and the indented row still fits", async ({
  page,
}, testInfo) => {
  await page.goto("/categories");

  // a long name on purpose: the indented row is the tightest case on a phone
  const parent = page
    .locator('[data-slot="item"]')
    .filter({ hasText: "Clothing, shoes, accessories" });

  await parent.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Add subcategory" }).click();

  const drawer = page.getByRole("dialog", { name: "New category" });
  await drawer.getByLabel("Name").fill("Sneakers");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer).toBeHidden();

  const child = page
    .locator('[data-slot="item"]')
    .filter({ hasText: "Sneakers" });
  await expect(child).toBeVisible();
  await expectNoHorizontalScroll(page);

  // indented, yet never past the right edge its parent row ends at
  const parentBox = (await parent.boundingBox()) ?? null;
  const childBox = (await child.boundingBox()) ?? null;
  expect(parentBox).not.toBeNull();
  expect(childBox).not.toBeNull();

  if (parentBox && childBox) {
    expect(childBox.x).toBeGreaterThan(parentBox.x);
    expect(childBox.x + childBox.width).toBeLessThanOrEqual(
      parentBox.x + parentBox.width + 0.5,
    );
    // the indent must not cost the row a second line: name, badge and menu
    // only split apart once the name would be squeezed under its 10rem floor
    expect(childBox.height).toBe(parentBox.height);
  }

  await page.screenshot({
    path: testInfo.outputPath("categories-subcategory.png"),
    fullPage: true,
  });
});
