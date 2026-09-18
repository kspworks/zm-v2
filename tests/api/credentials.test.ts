import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { recoveryLinks, sessions, twoFactors } from "~/server/db/schema";
import { generateTotp } from "~/server/lib/totp";
import { AuthSession } from "../helpers/auth-http";
import { anonymousCaller, callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import { createAdmin, createUserWithCredentials } from "../helpers/fixtures";

afterEach(() => {
  vi.useRealTimers();
});

/** Signs in through better-auth; returns whether a session resulted */
const signIn = async (
  email: string,
  password: string,
  code: string,
  backup = false,
) => {
  const browser = new AuthSession();
  await browser.post("/sign-in/email", { email, password });
  await browser.post(
    backup ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp",
    {
      code,
    },
  );

  return (await browser.session()) !== null;
};

const tokenOf = (url: string) => new URL(url).searchParams.get("token") ?? "";

/** The secret behind a QR's manual key (base32 of the raw secret's bytes) */
const secretFromManualKey = (manualKey: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";

  for (const char of manualKey) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }

  const bytes = bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? [];

  return Buffer.from(bytes).toString("utf8");
};

const withSession = (userId: string, sessionId: string) =>
  createCaller({
    db,
    userId,
    sessionId,
    locale: "en",
    origin: "http://localhost:3000",
  });

const addSessions = (userId: string, ...ids: string[]) =>
  db
    .insert(sessions)
    .values(
      ids.map((id) => ({
        id,
        token: `token-${id}`,
        userId,
        expiresAt: new Date(Date.now() + 3600_000),
      })),
    );

describe("settings.changePassword", () => {
  it("needs the current password and a TOTP code, and keeps only this session", async () => {
    const { user, password, secret } = await createUserWithCredentials();
    await addSessions(user.id, "current", "other");
    const caller = withSession(user.id, "current");

    await expectTRPCError(
      caller.settings.changePassword({
        currentPassword: "wrong!",
        newPassword: "newsecret",
        code: generateTotp(secret),
      }),
      "BAD_REQUEST",
      "invalid_password",
    );
    await expectTRPCError(
      caller.settings.changePassword({
        currentPassword: password,
        newPassword: "newsecret",
        code: "000000",
      }),
      "BAD_REQUEST",
      "invalid_code",
    );

    await caller.settings.changePassword({
      currentPassword: password,
      newPassword: "newsecret",
      code: generateTotp(secret),
    });

    expect((await db.select().from(sessions)).map((s) => s.id)).toEqual([
      "current",
    ]);
    expect(await signIn(user.email, password, generateTotp(secret))).toBe(
      false,
    );
    expect(await signIn(user.email, "newsecret", generateTotp(secret))).toBe(
      true,
    );
  });
});

describe("settings re-enrolment", () => {
  it("switches to a new authenticator only after a code from it", async () => {
    const { user, password, secret, backupCodes } =
      await createUserWithCredentials();
    await addSessions(user.id, "current", "other");
    const caller = withSession(user.id, "current");

    // a backup code works as the second factor here
    const started = await caller.settings.startReenrol({
      password,
      code: backupCodes[0] ?? "",
    });
    const newSecret = secretFromManualKey(started.manualKey);
    expect(started.qrDataUrl).toMatch(/^data:image\/png/);

    // nothing changes until confirmed
    expect(await signIn(user.email, password, generateTotp(secret))).toBe(true);

    await expectTRPCError(
      caller.settings.confirmReenrol({ code: "000000" }),
      "BAD_REQUEST",
      "invalid_code",
    );

    const confirmed = await caller.settings.confirmReenrol({
      code: generateTotp(newSecret),
    });
    expect(confirmed.backupCodes).toHaveLength(10);

    expect(await signIn(user.email, password, generateTotp(secret))).toBe(
      false,
    );
    expect(await signIn(user.email, password, generateTotp(newSecret))).toBe(
      true,
    );
    // old backup codes are gone too
    expect(await signIn(user.email, password, backupCodes[1] ?? "", true)).toBe(
      false,
    );
    // other sessions were revoked (the sign-ins above created new ones)
    expect(
      (await db.select().from(sessions)).some((s) => s.id === "other"),
    ).toBe(false);
  });

  it("refuses a wrong password", async () => {
    const { user, secret } = await createUserWithCredentials();

    await expectTRPCError(
      callerFor(user).settings.startReenrol({
        password: "nope",
        code: generateTotp(secret),
      }),
      "BAD_REQUEST",
      "invalid_password",
    );
  });
});

describe("settings.backupCodes", () => {
  it("regenerates the codes; the old ones stop working", async () => {
    const { user, password, secret, backupCodes } =
      await createUserWithCredentials();

    const { backupCodes: fresh } = await callerFor(user).settings.backupCodes({
      password,
      code: generateTotp(secret),
    });

    expect(fresh).toHaveLength(10);
    expect(await signIn(user.email, password, backupCodes[0] ?? "", true)).toBe(
      false,
    );
    expect(await signIn(user.email, password, fresh[0] ?? "", true)).toBe(true);
  });
});

describe("recovery links", () => {
  const link = async (scope: "password" | "twoFactor" | "both") => {
    const admin = await createAdmin();
    const target = await createUserWithCredentials();
    const created = await callerFor(admin).admin.createRecoveryLink({
      userId: target.user.id,
      scope,
    });

    return { admin, ...target, token: tokenOf(created.url), created };
  };

  it("stores only a hash and shows the link once", async () => {
    const { token, created } = await link("password");

    expect(created.url).toMatch(
      /^http:\/\/localhost:3000\/auth\/recover\?token=/,
    );
    const [row] = await db.select().from(recoveryLinks);
    expect(row?.tokenHash).not.toContain(token);
    expect(await anonymousCaller().recovery.validate({ token })).toMatchObject({
      scope: "password",
    });
  });

  it("password scope: sets a new password, keeps 2FA, no automatic sign-in", async () => {
    const { user, secret, token } = await link("password");
    await addSessions(user.id, "s1");

    const result = await anonymousCaller().recovery.complete({
      token,
      newPassword: "recovered",
    });

    expect(result).toEqual({ backupCodes: null, ticket: null });
    expect(await db.select().from(sessions)).toEqual([]);
    expect(await signIn(user.email, "recovered", generateTotp(secret))).toBe(
      true,
    );
  });

  it("2FA scope: needs the current password, then a fresh authenticator", async () => {
    const { user, password, secret, token } = await link("twoFactor");
    const { manualKey } = await anonymousCaller().recovery.startEnrolment({
      token,
    });
    const fresh = secretFromManualKey(manualKey);

    await expectTRPCError(
      anonymousCaller().recovery.complete({
        token,
        currentPassword: "wrong",
        code: generateTotp(fresh),
      }),
      "BAD_REQUEST",
      "invalid_password",
    );

    const result = await anonymousCaller().recovery.complete({
      token,
      currentPassword: password,
      code: generateTotp(fresh),
    });

    expect(result.backupCodes).toHaveLength(10);
    expect(result.ticket).toBeTruthy();
    expect(await signIn(user.email, password, generateTotp(secret))).toBe(
      false,
    );
    expect(await signIn(user.email, password, generateTotp(fresh))).toBe(true);
  });

  it("both: a new password and a new authenticator", async () => {
    const { user, token } = await link("both");
    const { manualKey } = await anonymousCaller().recovery.startEnrolment({
      token,
    });
    const fresh = secretFromManualKey(manualKey);

    await anonymousCaller().recovery.complete({
      token,
      newPassword: "brandnew",
      code: generateTotp(fresh),
    });

    expect(await signIn(user.email, "brandnew", generateTotp(fresh))).toBe(
      true,
    );
  });

  it("is single use", async () => {
    const { token } = await link("password");
    await anonymousCaller().recovery.complete({
      token,
      newPassword: "recovered",
    });

    await expectTRPCError(
      anonymousCaller().recovery.complete({ token, newPassword: "again!" }),
      "FORBIDDEN",
      "recovery_link_invalid",
    );
  });

  it("expires after 24 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
    const { token } = await link("password");

    vi.setSystemTime(new Date("2026-03-02T09:59:00Z"));
    await expect(
      anonymousCaller().recovery.validate({ token }),
    ).resolves.toBeTruthy();

    vi.setSystemTime(new Date("2026-03-02T10:00:01Z"));
    await expectTRPCError(
      anonymousCaller().recovery.validate({ token }),
      "FORBIDDEN",
      "recovery_link_invalid",
    );
  });

  it("a new link revokes the previous unused one; links can be revoked", async () => {
    const { admin, user, token: first } = await link("password");
    const second = await callerFor(admin).admin.createRecoveryLink({
      userId: user.id,
      scope: "both",
    });

    await expectTRPCError(
      anonymousCaller().recovery.validate({ token: first }),
      "FORBIDDEN",
    );

    const [active] = await callerFor(admin).admin.recoveryLinks({
      userId: user.id,
    });
    expect(active).toMatchObject({ id: second.id, scope: "both" });

    await callerFor(admin).admin.revokeRecoveryLink({ id: second.id });
    await expectTRPCError(
      anonymousCaller().recovery.validate({ token: tokenOf(second.url) }),
      "FORBIDDEN",
    );
  });

  it("limits code attempts to 10 per link", async () => {
    const { token } = await link("both");
    await anonymousCaller().recovery.startEnrolment({ token });

    for (let i = 0; i < 10; i++) {
      await expectTRPCError(
        anonymousCaller().recovery.complete({
          token,
          newPassword: "brandnew",
          code: "000000",
        }),
        "BAD_REQUEST",
        "invalid_code",
      );
    }

    await expectTRPCError(
      anonymousCaller().recovery.complete({
        token,
        newPassword: "brandnew",
        code: "000000",
      }),
      "TOO_MANY_REQUESTS",
      "otp_attempts_exceeded",
    );
  });

  it("2FA scope keeps 2FA data untouched until completion", async () => {
    const { user, token } = await link("twoFactor");
    const before = await db.query.twoFactors.findFirst({
      where: eq(twoFactors.userId, user.id),
    });

    await anonymousCaller().recovery.startEnrolment({ token });

    const after = await db.query.twoFactors.findFirst({
      where: eq(twoFactors.userId, user.id),
    });
    expect(after?.secret).toBe(before?.secret);
  });
});
