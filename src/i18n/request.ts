import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { LOCALE_COOKIE, resolveLocale } from "~/i18n/config";
import { loadMessages } from "~/i18n/messages";
import { getCurrentUser } from "~/server/auth/session";
import { appTimezone } from "~/server/config";

export default getRequestConfig(async () => {
  const [cookieStore, headerStore, user] = await Promise.all([
    cookies(),
    headers(),
    getCurrentUser().catch(() => null),
  ]);

  const locale = resolveLocale({
    profile: user?.locale,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: appTimezone(),
  };
});
