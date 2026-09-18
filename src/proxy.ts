import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { HOME_PATH, isPublicPath, loginRedirectPath } from "~/lib/auth-routing";

/**
 * The route gate: a cheap cookie-presence check. The session itself is
 * validated against the database by every protected procedure and page.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/") {
    return NextResponse.redirect(new URL(HOME_PATH, request.url));
  }

  if (isPublicPath(pathname) || getSessionCookie(request)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(
    new URL(loginRedirectPath(pathname, search), request.url),
  );
}

export const config = {
  // skip Next's static assets and any file with an extension (favicon, images)
  matcher: ["/((?!_next/static|_next/image|.*\\.\\w+$).*)"],
};
