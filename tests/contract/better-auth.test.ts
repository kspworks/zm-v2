import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { issueSignInTicket } from "~/server/auth/sign-in-ticket";
import { db } from "~/server/db";
import { rateLimits, sessions, users } from "~/server/db/schema";
import { generateTotp } from "~/server/lib/totp";
import { AuthSession } from "../helpers/auth-http";
import { createUserWithCredentials } from "../helpers/fixtures";

/**
 * Contract: better-auth's email + TOTP sign-in, driven through its public
 * HTTP handler. A major bump that changes the flow fails here first.
 */
describe("better-auth sign-in with TOTP", () => {
  it("asks for the second factor, then creates a session", async () => {
    const { user, password, secret } = await createUserWithCredentials();
    const browser = new AuthSession();

    const first = await browser.post("/sign-in/email", {
      email: user.email,
      password,
    });

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
    expect(await browser.session()).toBeNull();

    const second = await browser.post("/two-factor/verify-totp", {
      code: generateTotp(secret),
    });

    expect(second.status).toBe(200);

    const session = await browser.session();
    expect(session?.user.id).toBe(user.id);
    // 14-day database sessions
    const ttl = (session?.session.expiresAt.getTime() ?? 0) - Date.now();
    expect(ttl).toBeGreaterThan(13.9 * 24 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(14 * 24 * 3600_000 + 1000);
  });

  it("matches the email case-insensitively", async () => {
    const { user, password } = await createUserWithCredentials();
    const browser = new AuthSession();

    const response = await browser.post("/sign-in/email", {
      email: user.email.toUpperCase(),
      password,
    });

    expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
  });

  it("rejects a wrong password with 401", async () => {
    const { user } = await createUserWithCredentials();
    const response = await new AuthSession().post("/sign-in/email", {
      email: user.email,
      password: "wrong-password",
    });

    expect(response.status).toBe(401);
  });

  it("rejects a wrong TOTP code", async () => {
    const { user, password } = await createUserWithCredentials();
    const browser = new AuthSession();
    await browser.post("/sign-in/email", { email: user.email, password });

    const response = await browser.post("/two-factor/verify-totp", {
      code: "000000",
    });

    expect(response.status).toBe(401);
    expect(await browser.session()).toBeNull();
  });

  it("accepts a backup code once", async () => {
    const { user, password, backupCodes } = await createUserWithCredentials();
    const code = backupCodes[0] ?? "";

    const browser = new AuthSession();
    await browser.post("/sign-in/email", { email: user.email, password });
    const ok = await browser.post("/two-factor/verify-backup-code", { code });

    expect(ok.status).toBe(200);
    expect((await browser.session())?.user.id).toBe(user.id);

    const again = new AuthSession();
    await again.post("/sign-in/email", { email: user.email, password });
    const reused = await again.post("/two-factor/verify-backup-code", { code });

    expect(reused.status).toBe(401);
  });

  it("refuses to sign in a soft-deleted user", async () => {
    const { user, password, secret } = await createUserWithCredentials();
    const browser = new AuthSession();
    await browser.post("/sign-in/email", { email: user.email, password });

    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, user.id));

    await browser.post("/two-factor/verify-totp", {
      code: generateTotp(secret),
    });

    expect(await browser.session()).toBeNull();
  });

  it("refuses public sign-up", async () => {
    const response = await new AuthSession().post("/sign-up/email", {
      email: "x@example.com",
      password: "secret123",
      name: "X",
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(users)).toHaveLength(0);
  });
});

describe("login rate limit", () => {
  it("allows 10 attempts per 15 min per lowercased email, then 429", async () => {
    const { user } = await createUserWithCredentials();

    for (let i = 0; i < 10; i++) {
      const response = await new AuthSession().post("/sign-in/email", {
        email: i % 2 ? user.email.toUpperCase() : user.email,
        password: "wrong-password",
      });
      expect(response.status).toBe(401);
    }

    const blocked = await new AuthSession().post("/sign-in/email", {
      email: user.email,
      password: "wrong-password",
    });

    expect(blocked.status).toBe(429);
  });

  it("resets after a successful sign-in", async () => {
    const { user, password, secret } = await createUserWithCredentials();

    for (let i = 0; i < 5; i++) {
      await new AuthSession().post("/sign-in/email", {
        email: user.email,
        password: "wrong-password",
      });
    }

    const browser = new AuthSession();
    await browser.post("/sign-in/email", { email: user.email, password });
    await browser.post("/two-factor/verify-totp", {
      code: generateTotp(secret),
    });

    expect(await browser.session()).not.toBeNull();
    expect(
      await db
        .select()
        .from(rateLimits)
        .where(eq(rateLimits.key, `login:email:${user.email}`)),
    ).toHaveLength(0);
  });
});

describe("sign-in ticket", () => {
  it("creates a session once and cannot be replayed", async () => {
    const { user } = await createUserWithCredentials();
    const ticket = await issueSignInTicket(db, user.id);

    const browser = new AuthSession();
    const response = await browser.post("/zm/ticket-sign-in", { ticket });

    expect(response.status).toBe(200);
    expect((await browser.session())?.user.id).toBe(user.id);

    const replay = await new AuthSession().post("/zm/ticket-sign-in", {
      ticket,
    });
    expect(replay.status).toBe(401);
  });

  it("rejects an unknown ticket", async () => {
    const response = await new AuthSession().post("/zm/ticket-sign-in", {
      ticket: "nope",
    });

    expect(response.status).toBe(401);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});
