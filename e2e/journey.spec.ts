import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./helpers";

/**
 * The loop the app exists for: open an account, record money going in and
 * out, plan the next payment and look at the report. Every step crosses tRPC,
 * a real transaction and the Radix overlays (select, popover, dialog).
 */

const ACCOUNT = "Journey Card";

/** Radix Select: open the trigger by its label, pick an option by name */
const pickOption = async (
  page: Page,
  scope: Locator,
  label: string,
  option: string | RegExp,
) => {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option }).click();
};

/** The category combobox: a popover with a searchable command list */
const pickCategory = async (page: Page, dialog: Locator, name: string) => {
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await page.getByPlaceholder("Search category…").fill(name);
  await page.getByRole("option", { name, exact: true }).click();
};

test("records money on a new account, plans the next payment and reports it", async ({
  page,
}) => {
  await test.step("open an account", async () => {
    await page.goto("/accounts");
    // the page's own button, not the sidebar's "+" of the same name
    await page
      .locator("main")
      .getByRole("button", { name: "Add account" })
      .click();

    const dialog = page.getByRole("dialog", { name: "New account" });
    await dialog.getByLabel("Name").fill(ACCOUNT);
    await pickOption(page, dialog, "Type", "Card");
    await dialog.getByLabel("Initial balance").fill("1000");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(ACCOUNT)).toBeVisible();
  });

  await test.step("record an expense and an income in one sitting", async () => {
    await page.goto("/transactions");
    await page
      .locator("main")
      .getByRole("button", { name: "Add transaction" })
      .click();

    const dialog = page.getByRole("dialog", { name: "New transaction" });
    await dialog.getByLabel("Amount").fill("250");
    await pickCategory(page, dialog, "Groceries");
    await pickOption(page, dialog, "Account", new RegExp(ACCOUNT));
    await dialog.getByLabel("Comment").fill("Weekly shop");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Weekly shop").first()).toBeVisible();
    // creating keeps the dialog open for the next entry, with the per-entry
    // fields cleared and the account kept
    await expect(dialog.getByLabel("Amount")).toHaveValue("");
    await expect(dialog.getByLabel("Account", { exact: true })).toContainText(
      ACCOUNT,
    );

    await dialog.getByRole("tab", { name: "Income" }).click();
    await dialog.getByLabel("Amount").fill("3000");
    await pickCategory(page, dialog, "Salary");
    await dialog.getByLabel("Comment").fill("September pay");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByLabel("Amount")).toHaveValue("");

    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dialog).toBeHidden();

    const list = page.locator("main");
    await expect(list.getByText("Weekly shop")).toBeVisible();
    await expect(list.getByText("September pay")).toBeVisible();
  });

  await test.step("the account balance follows", async () => {
    await page.goto("/accounts");
    // 1000 - 250 + 3000
    await expect(
      page.locator("[data-slot='item']").filter({ hasText: ACCOUNT }),
    ).toContainText(/3[\s,.]?750/);
  });

  await test.step("plan the next payment", async () => {
    await page.goto("/planned");
    await page
      .locator("main")
      .getByRole("button", { name: "Plan a transaction" })
      .click();

    const dialog = page.getByRole("dialog", {
      name: "New planned transaction",
    });
    await dialog.getByLabel("Amount").fill("99");
    await pickCategory(page, dialog, "Subscriptions and online payments");
    await pickOption(page, dialog, "Account", new RegExp(ACCOUNT));
    await dialog.getByLabel("Comment").fill("Streaming");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByLabel("Amount")).toHaveValue("");

    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("main").getByText("Streaming")).toBeVisible();
  });

  await test.step("the report shows the spending", async () => {
    await page.goto("/reports");
    await expect(page.getByText("Groceries").first()).toBeVisible();
  });
});
