export const LOCALES = ["en", "uk"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "uk";

export const LOCALE_COOKIE = "NEXT_LOCALE";

/** One year, in seconds */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/**
 * Picks the best supported locale from an Accept-Language header: entries are
 * sorted by q (stable for ties), and each tag is matched by its base language,
 * so "uk-UA" and "en-US" count. "ua" is accepted as a legacy alias of "uk".
 */
export const negotiateLocale = (
  header: string | null | undefined,
): Locale | null => {
  if (!header) {
    return null;
  }

  const entries = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const qParam = params.find((param) => param.trim().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;

      return {
        base: tag.trim().toLowerCase().split("-")[0] ?? "",
        q: Number.isFinite(q) ? q : 0,
        index,
      };
    })
    .filter(({ base, q }) => base !== "" && q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const { base } of entries) {
    const candidate = base === "ua" ? "uk" : base;

    if (isLocale(candidate)) {
      return candidate;
    }
  }

  return null;
};

/** Resolution order: the signed-in user's profile, the cookie, the header, the default */
export const resolveLocale = ({
  profile,
  cookie,
  acceptLanguage,
}: {
  profile?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale => {
  if (isLocale(profile)) {
    return profile;
  }

  if (isLocale(cookie)) {
    return cookie;
  }

  return negotiateLocale(acceptLanguage) ?? DEFAULT_LOCALE;
};
