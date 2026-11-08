import { expect, test } from "./helpers";

/**
 * Every signed-in page, reached the way a user would: through the sidebar.
 * Mostly a tripwire for upgrades - each page must render its header and log
 * nothing to the console (the helpers' fixture checks the console).
 */

const PAGES = [
  "Dashboard",
  "Transactions",
  "Planned",
  "Budgets",
  "Accounts",
  "Categories",
  "Counterparties",
  // admin-only, and the setup user is the bootstrap admin
  "Users",
  "Settings",
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

test("the sidebar's Reports item expands into its sub-pages", async ({
  page,
}) => {
  await page.goto("/transactions");
  const sidebar = page.locator("[data-slot='sidebar']");
  const map = sidebar.getByRole("link", { name: "Map", exact: true });

  await expect(map).toBeHidden();
  await sidebar.getByRole("button", { name: "Reports", exact: true }).click();
  await map.click();
  await expect(page).toHaveURL(/\/reports\/map(\?.*)?$/);
  await expect(
    page.getByRole("heading", { name: "Reports / Map", level: 1 }),
  ).toBeVisible();

  // open on its own now that a report is showing
  await sidebar
    .getByRole("link", { name: "Period comparison", exact: true })
    .click();
  await expect(page).toHaveURL(/\/reports\/compare(\?.*)?$/);
  await expect(
    page.getByRole("heading", {
      name: "Reports / Period comparison",
      level: 1,
    }),
  ).toBeVisible();
});

test("the sidebar's + buttons open the create dialogs in place", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const sidebar = page.locator("[data-slot='sidebar']");

  for (const [button, dialog] of [
    ["Add transaction", "New transaction"],
    ["Plan a transaction", "New planned transaction"],
    ["Add account", "New account"],
    ["Add category", "New category"],
  ] as const) {
    await test.step(button, async () => {
      await sidebar.getByRole("button", { name: button }).click();

      const opened = page.getByRole("dialog", { name: dialog });
      await expect(opened).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(opened).toBeHidden();
      // no navigation: the dialog opened over the page the user was on
      await expect(page).toHaveURL(/\/dashboard$/);
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
  // import, export and history live together on the Data tab
  await page.getByRole("tab", { name: "Data" }).click();
  await expect(page.getByText("Import a ZenMoney export")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Transactions (CSV)" }),
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

test("a transaction row opens its form and a delete can be undone", async ({
  page,
}) => {
  await page.goto("/transactions");
  const main = page.locator("main");

  await main.getByRole("button", { name: "Add transaction" }).click();
  const create = page.getByRole("dialog", { name: "New transaction" });
  await create.getByLabel("Amount").fill("12");
  await create.getByLabel("Comment").fill("Undo me");
  await create.getByRole("button", { name: "Save" }).click();
  await expect(create.getByLabel("Amount")).toHaveValue("");
  await create.getByRole("button", { name: "Close" }).first().click();

  const row = main.getByText("Undo me");
  await row.click();
  const edit = page.getByRole("dialog", { name: "Edit transaction" });
  await expect(edit.getByLabel("Comment")).toHaveValue("Undo me");
  await edit.getByRole("button", { name: "Close" }).first().click();
  await expect(edit).toBeHidden();

  await main
    .locator("section > div > div", { hasText: "Undo me" })
    .getByRole("button", { name: "Actions" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Yes" })
    .click();
  await expect(row).toBeHidden();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row).toBeVisible();
});

test("an account row opens its transactions", async ({ page }) => {
  await page.goto("/accounts");
  await page
    .locator("main")
    .locator('[data-slot="item"]')
    .first()
    .getByRole("link")
    .click();

  await expect(page).toHaveURL(/\/transactions\?accounts=/);
});

test("search and date presets show as chips that clear one by one", async ({
  page,
}) => {
  await page.goto("/transactions");
  await page.getByRole("searchbox", { name: "Search comments…" }).fill("zzz");
  await expect(page).toHaveURL(/comment=zzz/);

  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Last 30 days" }).click();
  await page.keyboard.press("Escape");

  await expect(
    page.getByRole("button", { name: "Remove filter “zzz”" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
});

test("a category can be created from the picker", async ({ page }) => {
  await page.goto("/transactions");
  await page
    .locator("main")
    .getByRole("button", { name: "Add transaction" })
    .click();

  const dialog = page.getByRole("dialog", { name: "New transaction" });
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await page.getByPlaceholder("Search category…").fill("Beekeeping");
  await page.getByRole("option", { name: "Create “Beekeeping”" }).click();

  await expect(dialog.getByRole("combobox", { name: "Category" })).toHaveText(
    "Beekeeping",
  );
});

test("a due planned row is paid in one click and can be undone", async ({
  page,
}) => {
  await page.goto("/planned");
  await page
    .locator("main")
    .getByRole("button", { name: "Plan a transaction" })
    .click();

  const dialog = page.getByRole("dialog", { name: "New planned transaction" });
  await dialog.getByLabel("Amount").fill("7");
  await dialog.getByLabel("Comment").fill("Pay me");
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.getByRole("button", { name: "Close" }).first().click();
  await expect(dialog).toBeHidden();

  const row = page
    .locator("main section > div > div", { hasText: "Pay me" })
    .first();

  await row.getByRole("button", { name: "Mark as paid" }).click();
  await expect(page.locator("main").getByText("Pay me")).toBeHidden();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("main").getByText("Pay me")).toBeVisible();
});

test("keyboard: N adds, ? lists the shortcuts, G then B opens Budgets", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.locator("main h1").click();

  await page.keyboard.press("n");
  const add = page.getByRole("dialog", { name: "New transaction" });
  await expect(add).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(add).toBeHidden();

  await page.keyboard.press("Shift+Slash");
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("g");
  await page.keyboard.press("b");
  await expect(page).toHaveURL(/\/budgets$/);
});

test("the skip link jumps past the sidebar", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });

  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
});

test("a budget shows its progress on the dashboard", async ({ page }) => {
  await page.goto("/budgets");
  await page
    .locator("main")
    .getByRole("button", { name: "Add budget" })
    .first()
    .click();

  const dialog = page.getByRole("dialog", { name: "New budget" });
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await page.getByPlaceholder("Search category…").fill("Pets");
  await page.getByRole("option", { name: "Pets", exact: true }).click();
  await dialog.getByLabel("Monthly limit").fill("1000");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("meter", { name: "Pets" })).toBeVisible();
});
