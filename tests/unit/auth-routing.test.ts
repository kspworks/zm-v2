import { describe, expect, it } from "vitest";

import {
  authErrorFromStatus,
  isPublicPath,
  loginRedirectPath,
  sanitizeAuthError,
  sanitizeCallbackUrl,
} from "~/lib/auth-routing";

describe("sanitizeCallbackUrl", () => {
  it.each([
    ["/accounts", "/accounts"],
    [
      "/transactions?accounts=a&accounts=b",
      "/transactions?accounts=a&accounts=b",
    ],
    ["/planned#top", "/planned#top"],
  ])("keeps same-origin path %s", (input, expected) => {
    expect(sanitizeCallbackUrl(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["https://evil.example/steal"],
    ["//evil.example/path"],
    ["/\\evil.example"],
    ["\\\\evil.example"],
    ["javascript:alert(1)"],
    ["accounts"],
    [`/acc${String.fromCharCode(10)}ounts`],
    ["/auth/login?callbackUrl=/x"],
  ])("replaces %j with /transactions", (input) => {
    expect(sanitizeCallbackUrl(input)).toBe("/transactions");
  });
});

describe("isPublicPath", () => {
  it.each([
    "/auth/login",
    "/auth/register/invite",
    "/auth/reset",
    "/auth/recover",
    "/api/trpc/me.get",
    "/api/auth/sign-in/email",
    "/monitoring",
  ])("%s is public", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(["/transactions", "/accounts", "/auth/loginx", "/users"])(
    "%s is gated",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});

describe("loginRedirectPath", () => {
  it("carries the path and the query", () => {
    expect(loginRedirectPath("/planned", "?accounts=a")).toBe(
      "/auth/login?callbackUrl=%2Fplanned%3Faccounts%3Da",
    );
  });
});

describe("auth error allow-list", () => {
  it.each([
    "CredentialsSignin",
    "TooManyRequests",
    "ServiceUnavailable",
    "Default",
  ])("keeps %s", (code) => {
    expect(sanitizeAuthError(code)).toBe(code);
  });

  it("maps unknown codes and raw error text to Default", () => {
    expect(sanitizeAuthError("OAuthAccountNotLinked")).toBe("Default");
    expect(sanitizeAuthError("<script>alert(1)</script>")).toBe("Default");
    expect(sanitizeAuthError('relation "users" does not exist')).toBe(
      "Default",
    );
  });

  it("returns null when there is no error", () => {
    expect(sanitizeAuthError(null)).toBeNull();
    expect(sanitizeAuthError("")).toBeNull();
  });

  it("never reports an infrastructure failure as wrong credentials", () => {
    expect(authErrorFromStatus(401)).toBe("CredentialsSignin");
    expect(authErrorFromStatus(429)).toBe("TooManyRequests");
    expect(authErrorFromStatus(500)).toBe("ServiceUnavailable");
    expect(authErrorFromStatus(503)).toBe("ServiceUnavailable");
    expect(authErrorFromStatus(undefined)).toBe("ServiceUnavailable");
    expect(authErrorFromStatus(418)).toBe("Default");
  });
});
