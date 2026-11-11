import { expect, test } from "./helpers";

/**
 * A page's own client code can arrive after the layout's. Until it does, the
 * page stays dehydrated while the sidebar already works, and a "+" dialog
 * opened in that window fills the query cache with lists the page reads
 * (accounts.list, categories.list). The page must hydrate the same either
 * way: what the cache holds must never change the markup React compares
 * against the server HTML.
 *
 * The race is forced by holding the chunk with the page's view, found by a
 * string only it contains, until the dialog's query has answered. The helpers'
 * fixture fails the test on the resulting hydration error.
 */
const CASES = [
  {
    path: "/dashboard",
    heading: "Dashboard",
    // a localStorage key of the dashboard's
    marker: "zm.dashboard.balance.range",
    button: "Add transaction",
    dialog: "New transaction",
    query: "accounts.list",
  },
  {
    path: "/transactions",
    heading: "Transactions",
    // the message key of its empty state
    marker: '"emptyNoAccounts"',
    button: "Add transaction",
    dialog: "New transaction",
    query: "accounts.list",
  },
  {
    path: "/planned",
    heading: "Planned",
    marker: "zm.planned.view",
    button: "Plan a transaction",
    dialog: "New planned transaction",
    query: "accounts.list",
  },
  {
    path: "/accounts",
    heading: "Accounts",
    // the message key of the deactivate action
    marker: '"deactivate"',
    button: "Add transaction",
    dialog: "New transaction",
    query: "accounts.list",
  },
  {
    path: "/categories",
    heading: "Categories",
    // the message key of the add-subcategory action
    marker: '"addChild"',
    button: "Add category",
    dialog: "New category",
    query: "categories.list",
  },
] as const;

for (const { path, heading, marker, button, dialog, query } of CASES) {
  test(`${path} hydrates the same when a dialog filled the cache first`, async ({
    page,
  }) => {
    let held = false;
    const { promise: released, resolve: release } =
      Promise.withResolvers<void>();

    await page.route("**/_next/static/chunks/**", async (route) => {
      const response = await route.fetch();
      const body = await response.text();

      if (body.includes(marker)) {
        held = true;
        await released;
      }
      await route.fulfill({ response, body });
    });

    const answered = page.waitForResponse(
      (response) =>
        response.url().includes("/api/trpc/") && response.url().includes(query),
    );

    // "load" would wait for the chunk held back above
    await page.goto(path, { waitUntil: "commit" });

    // the shell may not be hydrated yet, when a click does nothing
    const sidebar = page.locator("[data-slot='sidebar']");
    const opened = page.getByRole("dialog", { name: dialog });
    await expect(async () => {
      await sidebar.getByRole("button", { name: button }).click();
      await expect(opened).toBeVisible({ timeout: 1_000 });
    }).toPass();

    await answered;
    // the chunk really was held back, so the race above did happen
    expect(held, "the page's chunk was not found to hold back").toBe(true);
    // let TanStack Query write the response into the cache
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    );
    release();

    await page.keyboard.press("Escape");
    await expect(opened).toBeHidden();
    await expect(
      page.getByRole("heading", { name: heading, level: 1 }),
    ).toBeVisible();
    // the page hydrates once the chunk arrives and then loads its own data;
    // a mismatch is reported by then
    await page.waitForLoadState("networkidle");
  });
}
