import { auth } from "~/server/auth";

const BASE = "http://localhost:3000";

/**
 * A tiny cookie jar around better-auth's public HTTP handler, so tests drive
 * sign-in exactly like a browser would.
 */
export class AuthSession {
  private cookies = new Map<string, string>();

  get cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  headers(): Headers {
    return new Headers({ cookie: this.cookieHeader, origin: BASE });
  }

  async post(path: string, body: unknown): Promise<Response> {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: BASE,
          cookie: this.cookieHeader,
        },
        body: JSON.stringify(body),
      }),
    );

    for (const header of response.headers.getSetCookie()) {
      const [pair = ""] = header.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);

      if (value === "" || /max-age=0/i.test(header)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }

    return response;
  }

  async session() {
    return auth.api.getSession({ headers: this.headers() });
  }
}
