import { like } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import { sessions, verifications } from "~/server/db/schema";
import { generateTotp } from "~/server/lib/totp";
import { AuthSession } from "../helpers/auth-http";
import { createUserWithCredentials } from "../helpers/fixtures";

const requestReset = (email: string) =>
  new AuthSession().post("/request-password-reset", {
    email,
    redirectTo: "/auth/reset",
  });

const resetToken = async () => {
  const [row] = await db
    .select()
    .from(verifications)
    .where(like(verifications.identifier, "reset-password:%"));

  return row?.identifier.replace("reset-password:", "") ?? "";
};

const signIn = async (email: string, password: string, code: string) => {
  const browser = new AuthSession();
  await browser.post("/sign-in/email", { email, password });
  await browser.post("/two-factor/verify-totp", { code });

  return (await browser.session()) !== null;
};

/** Contract: better-auth's reset flow, plus the second factor we require */
describe("password reset by email", () => {
  it("answers the same for known and unknown addresses", async () => {
    const { user } = await createUserWithCredentials();

    const known = await requestReset(user.email);
    const unknown = await requestReset("nobody@example.com");

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it("needs the token AND a TOTP or backup code; never removes 2FA", async () => {
    const { user, password, secret } = await createUserWithCredentials();
    await db.insert(sessions).values({
      token: "old",
      userId: user.id,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await requestReset(user.email);
    const token = await resetToken();

    const noCode = await new AuthSession().post("/reset-password", {
      token,
      newPassword: "fresh-password",
    });
    expect(noCode.status).toBe(400);

    const wrongCode = await new AuthSession().post("/reset-password", {
      token,
      newPassword: "fresh-password",
      code: "000000",
    });
    expect(wrongCode.status).toBe(400);

    const ok = await new AuthSession().post("/reset-password", {
      token,
      newPassword: "fresh-password",
      code: generateTotp(secret),
    });
    expect(ok.status).toBe(200);

    // every session revoked, 2FA still required with the old authenticator
    expect(await db.select().from(sessions)).toEqual([]);
    expect(await signIn(user.email, password, generateTotp(secret))).toBe(
      false,
    );
    expect(
      await signIn(user.email, "fresh-password", generateTotp(secret)),
    ).toBe(true);
  });

  it("accepts a backup code instead of the TOTP", async () => {
    const { user, secret, backupCodes } = await createUserWithCredentials();
    await requestReset(user.email);

    const ok = await new AuthSession().post("/reset-password", {
      token: await resetToken(),
      newPassword: "fresh-password",
      code: backupCodes[0],
    });

    expect(ok.status).toBe(200);
    expect(
      await signIn(user.email, "fresh-password", generateTotp(secret)),
    ).toBe(true);
  });

  it("trims the code before checking it", async () => {
    const { user, secret, backupCodes } = await createUserWithCredentials();
    await requestReset(user.email);

    const ok = await new AuthSession().post("/reset-password", {
      token: await resetToken(),
      newPassword: "fresh-password",
      code: `  ${backupCodes[0]}  `,
    });

    expect(ok.status).toBe(200);
    expect(
      await signIn(user.email, "fresh-password", generateTotp(secret)),
    ).toBe(true);
  });

  it("limits requests to 3 per hour per email", async () => {
    const { user } = await createUserWithCredentials();

    for (let i = 0; i < 3; i++) {
      expect((await requestReset(user.email)).status).toBe(200);
    }

    expect((await requestReset(user.email.toUpperCase())).status).toBe(429);
  });
});
