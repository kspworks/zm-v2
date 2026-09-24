import { expect, test } from "./helpers";

/**
 * The README's screenshots, over the books demo.setup.ts seeds. Run through
 * `pnpm screenshots` (playwright.screenshots.config.ts); the regular browser
 * tests skip this file.
 */

const OUT = "docs/screenshots";

/** [heading, path, file name] - the README links the files by name */
const PAGES = [
  ["Dashboard", "/dashboard", "dashboard"],
  ["Transactions", "/transactions", "transactions"],
  ["Planned", "/planned", "planned"],
  ["Reports", "/reports/map", "reports"],
] as const;

test.use({ colorScheme: "dark" });

for (const [name, path, file] of PAGES) {
  test(name, async ({ page, isMobile }) => {
    // the phone shots are only the two pages people open most
    test.skip(isMobile && !["/dashboard", "/transactions"].includes(path));

    await page.goto(path);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    // let charts finish their entry animation
    await page.waitForTimeout(1_000);

    await page.screenshot({
      path: `${OUT}/${isMobile ? "mobile-" : ""}${file}.png`,
      animations: "disabled",
    });
  });
}
