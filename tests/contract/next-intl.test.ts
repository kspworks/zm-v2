import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import { LOCALES } from "~/i18n/config";
import { loadMessages } from "~/i18n/messages";

/**
 * Contract: next-intl renders our typed messages outside a request (used for
 * seeds, the debt account name and emails), including ICU plurals.
 */
describe("next-intl", () => {
  it("translates seed names in each locale", async () => {
    const en = createTranslator({
      locale: "en",
      messages: await loadMessages("en"),
    });
    const uk = createTranslator({
      locale: "uk",
      messages: await loadMessages("uk"),
    });

    expect(en("seed.cash")).toBe("Cash");
    expect(uk("seed.cash")).toBe("Готівка");
    expect(uk("seed.debts")).toBe("Борги");
  });

  it("applies Ukrainian plural rules", () => {
    const t = createTranslator({
      locale: "uk",
      messages: {
        days: "{count, plural, one {# день} few {# дні} many {# днів} other {# дня}}",
      },
    });

    expect(t("days", { count: 1 })).toBe("1 день");
    expect(t("days", { count: 3 })).toBe("3 дні");
    expect(t("days", { count: 5 })).toBe("5 днів");
    expect(t("days", { count: 21 })).toBe("21 день");
  });

  it("has the same message keys in every locale", async () => {
    const keysOf = (value: unknown, prefix = ""): string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, child]) =>
            keysOf(child, prefix ? `${prefix}.${key}` : key),
          )
        : [prefix];

    const [first, ...rest] = await Promise.all(
      LOCALES.map(async (locale) => keysOf(await loadMessages(locale)).sort()),
    );

    for (const keys of rest) {
      expect(keys).toEqual(first);
    }
  });
});
