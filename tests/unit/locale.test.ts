import { describe, expect, it } from "vitest";

import { negotiateLocale, resolveLocale } from "~/i18n/config";

describe("negotiateLocale", () => {
  it("returns null without a header", () => {
    expect(negotiateLocale(undefined)).toBeNull();
    expect(negotiateLocale("")).toBeNull();
  });

  it("matches the base tag", () => {
    expect(negotiateLocale("uk-UA")).toBe("uk");
    expect(negotiateLocale("en-US,en;q=0.9")).toBe("en");
  });

  it("sorts by q, keeping header order for ties", () => {
    expect(negotiateLocale("en;q=0.5,uk;q=0.8")).toBe("uk");
    expect(negotiateLocale("de,en;q=0.7,uk;q=0.7")).toBe("en");
  });

  it("skips unsupported and q=0 entries", () => {
    expect(negotiateLocale("de,fr;q=0.9")).toBeNull();
    expect(negotiateLocale("en;q=0,uk;q=0.1")).toBe("uk");
  });

  it("maps the legacy ua tag to uk", () => {
    expect(negotiateLocale("ua")).toBe("uk");
  });
});

describe("resolveLocale", () => {
  it("prefers the profile", () => {
    expect(
      resolveLocale({ profile: "en", cookie: "uk", acceptLanguage: "uk" }),
    ).toBe("en");
  });

  it("falls back to the cookie", () => {
    expect(
      resolveLocale({ profile: null, cookie: "en", acceptLanguage: "uk" }),
    ).toBe("en");
  });

  it("ignores an invalid cookie and uses the header", () => {
    expect(resolveLocale({ cookie: "de", acceptLanguage: "en-GB" })).toBe("en");
  });

  it("defaults to uk", () => {
    expect(resolveLocale({})).toBe("uk");
  });
});
