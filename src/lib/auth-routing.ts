export const HOME_PATH = "/dashboard";
export const LOGIN_PATH = "/auth/login";

/** Pages reachable without a session */
export const PUBLIC_PAGES = [
  "/auth/login",
  "/auth/register/invite",
  "/auth/reset",
  "/auth/recover",
] as const;

/** Sentry's tunnel route (see next.config.ts) */
export const SENTRY_TUNNEL = "/monitoring";

export const isPublicPath = (pathname: string): boolean =>
  PUBLIC_PAGES.some(
    (page) => pathname === page || pathname.startsWith(`${page}/`),
  ) ||
  pathname.startsWith("/api/") ||
  pathname === SENTRY_TUNNEL ||
  pathname.startsWith(`${SENTRY_TUNNEL}/`);

const hasControlCharacters = (value: string): boolean =>
  [...value].some((char) => {
    const code = char.charCodeAt(0);

    return code < 0x20 || code === 0x7f;
  });

/**
 * Keeps a post-login redirect target only if it is a same-origin relative
 * path. Anything else (absolute URLs, protocol-relative "//host", backslash
 * tricks, control characters) is replaced with the home page.
 */
export const sanitizeCallbackUrl = (
  value: string | null | undefined,
): string => {
  if (!value || typeof value !== "string") {
    return HOME_PATH;
  }

  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacters(value)
  ) {
    return HOME_PATH;
  }

  try {
    const base = "http://zm.invalid";
    const url = new URL(value, base);

    if (url.origin !== base) {
      return HOME_PATH;
    }

    // never bounce back into the auth pages themselves
    if (url.pathname.startsWith("/auth/")) {
      return HOME_PATH;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return HOME_PATH;
  }
};

/** Builds the login redirect for a gated request */
export const loginRedirectPath = (pathname: string, search: string): string =>
  `${LOGIN_PATH}?callbackUrl=${encodeURIComponent(`${pathname}${search}`)}`;

/** The only error codes the login page will render; everything else is "Default" */
export const AUTH_ERROR_CODES = [
  "CredentialsSignin",
  "TooManyRequests",
  "ServiceUnavailable",
  "Default",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export const sanitizeAuthError = (
  value: string | null | undefined,
): AuthErrorCode | null => {
  if (!value) {
    return null;
  }

  return (AUTH_ERROR_CODES as readonly string[]).includes(value)
    ? (value as AuthErrorCode)
    : "Default";
};

/**
 * Maps a failed better-auth call's HTTP status to an allow-listed code. An
 * infrastructure failure is never reported as wrong credentials.
 */
export const authErrorFromStatus = (
  status: number | undefined,
): AuthErrorCode => {
  if (status === 401 || status === 400 || status === 403) {
    return "CredentialsSignin";
  }

  if (status === 429) {
    return "TooManyRequests";
  }

  if (status === undefined || status === 0 || status >= 500) {
    return "ServiceUnavailable";
  }

  return "Default";
};
