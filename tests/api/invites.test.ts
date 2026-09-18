import { and, eq, isNull } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "~/server/db";
import {
  accountMembers,
  accounts,
  authAccounts,
  categories,
  categoryMembers,
  historyLogs,
  invites,
  twoFactors,
  users,
} from "~/server/db/schema";
import { generateTotp } from "~/server/lib/totp";
import { anonymousCaller } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import { createAdmin, createUser } from "../helpers/fixtures";

const details = {
  name: "New Person",
  email: "New.Person@Example.com",
  password: "secret123",
};

const createInvite = async (id = "i".repeat(48), secret = "S".repeat(32)) => {
  await db
    .insert(invites)
    .values({ id, otpSecret: secret, comment: "test", createdBy: "SYSTEM" });

  return { id, secret };
};

const registerWith = (
  id: string,
  secret: string,
  overrides: Partial<typeof details & { code: string }> = {},
  locale: "en" | "uk" = "en",
) =>
  anonymousCaller({ locale }).invites.register({
    id,
    ...details,
    code: generateTotp(secret),
    ...overrides,
  });

/** The admin invite's secret lives in its row once a QR code was requested */
const adminSecret = async () => {
  const row = await db.query.invites.findFirst({
    where: eq(invites.id, "admin"),
  });

  return row?.otpSecret ?? "";
};

describe("invites.validate", () => {
  it("accepts an unclaimed invite", async () => {
    const { id } = await createInvite();

    expect(await anonymousCaller().invites.validate({ id })).toEqual({
      isAdmin: false,
    });
  });

  it("rejects unknown and claimed invites with FORBIDDEN", async () => {
    await expectTRPCError(
      anonymousCaller().invites.validate({ id: "nope" }),
      "FORBIDDEN",
      "invite_invalid",
    );

    const user = await createUser();
    await db.insert(invites).values({
      id: "claimed",
      otpSecret: null,
      userId: user.id,
      createdBy: "SYSTEM",
    });

    await expectTRPCError(
      anonymousCaller().invites.validate({ id: "claimed" }),
      "FORBIDDEN",
      "invite_invalid",
    );
  });

  describe("admin bootstrap", () => {
    it("is valid while there are no admins, before any row exists", async () => {
      expect(await anonymousCaller().invites.validate({ id: "admin" })).toEqual(
        { isAdmin: true },
      );
    });

    it("is invalid once an active admin exists", async () => {
      await createAdmin();

      await expectTRPCError(
        anonymousCaller().invites.validate({ id: "admin" }),
        "FORBIDDEN",
        "invite_invalid",
      );
    });

    it("re-opens when the last admin is soft-deleted", async () => {
      await createAdmin({ deletedAt: new Date() });

      expect(await anonymousCaller().invites.validate({ id: "admin" })).toEqual(
        { isAdmin: true },
      );
    });

    it("does not count banned admins", async () => {
      await createAdmin({ banned: true });

      expect(await anonymousCaller().invites.validate({ id: "admin" })).toEqual(
        { isAdmin: true },
      );
    });
  });
});

describe("invites.makeOtpQR", () => {
  it("returns a QR data URL and the base32 key of the invite secret", async () => {
    const { id } = await createInvite();
    const result = await anonymousCaller().invites.makeOtpQR({
      id,
      ...details,
    });

    expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.manualKey).toMatch(/^[A-Z2-7]+$/);
  });

  it("creates the admin invite row on demand and keeps its secret stable", async () => {
    const first = await anonymousCaller().invites.makeOtpQR({
      id: "admin",
      ...details,
    });
    const second = await anonymousCaller().invites.makeOtpQR({
      id: "admin",
      ...details,
    });

    const row = await db.query.invites.findFirst({
      where: eq(invites.id, "admin"),
    });

    expect(row?.createdBy).toBe("SYSTEM");
    expect(row?.otpSecret).toBeTruthy();
    expect(second.manualKey).toBe(first.manualKey);
  });

  it("rejects an email used by an active user, case-insensitively", async () => {
    const { id } = await createInvite();
    await createUser({ email: "new.person@example.com" });

    await expectTRPCError(
      anonymousCaller().invites.makeOtpQR({ id, ...details }),
      "BAD_REQUEST",
      "email_not_unique",
    );
  });

  it("allows an email that belonged to a soft-deleted user", async () => {
    const { id } = await createInvite();
    await createUser({
      email: "deleted-x@deleted.invalid",
      deletedEmail: "new.person@example.com",
      deletedAt: new Date(),
    });

    await expect(
      anonymousCaller().invites.makeOtpQR({ id, ...details }),
    ).resolves.toBeTruthy();
  });

  it("re-validates the invite", async () => {
    await expectTRPCError(
      anonymousCaller().invites.makeOtpQR({ id: "nope", ...details }),
      "FORBIDDEN",
      "invite_invalid",
    );
  });

  it("validates the details", async () => {
    const { id } = await createInvite();

    await expectTRPCError(
      anonymousCaller().invites.makeOtpQR({ id, ...details, name: "ab" }),
      "BAD_REQUEST",
    );
    await expectTRPCError(
      anonymousCaller().invites.makeOtpQR({
        id,
        ...details,
        password: "12345",
      }),
      "BAD_REQUEST",
    );
    await expectTRPCError(
      anonymousCaller().invites.makeOtpQR({ id, ...details, email: "nope" }),
      "BAD_REQUEST",
    );
  });
});

describe("invites.register", () => {
  it("creates the user, claims the invite and seeds accounts and categories", async () => {
    const { id, secret } = await createInvite();
    const result = await registerWith(id, secret, {}, "uk");

    expect(result.backupCodes).toHaveLength(10);
    expect(result.ticket).toHaveLength(48);

    const user = await db.query.users.findFirst({
      where: eq(users.email, "new.person@example.com"),
    });

    expect(user).toMatchObject({
      name: "New Person",
      role: "user",
      locale: "uk",
      twoFactorEnabled: true,
    });

    const userId = user?.id ?? "";

    const invite = await db.query.invites.findFirst({
      where: eq(invites.id, id),
    });
    expect(invite).toMatchObject({ userId, otpSecret: null });

    const credential = await db.query.authAccounts.findFirst({
      where: eq(authAccounts.userId, userId),
    });
    expect(credential?.providerId).toBe("credential");
    expect(credential?.password).toBeTruthy();
    expect(credential?.password).not.toContain("secret123");

    const factor = await db.query.twoFactors.findFirst({
      where: eq(twoFactors.userId, userId),
    });
    // stored encrypted, never as the plain secret
    expect(factor?.secret).toBeTruthy();
    expect(factor?.secret).not.toBe(secret);

    const seededAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.createdBy, userId));
    expect(seededAccounts).toHaveLength(4);
    expect(new Set(seededAccounts.map((a) => a.name))).toEqual(
      new Set(["Готівка"]),
    );
    expect(seededAccounts.every((a) => a.type === "cash")).toBe(true);
    expect(seededAccounts.every((a) => a.initialBalance === 0)).toBe(true);

    const members = await db
      .select()
      .from(accountMembers)
      .where(eq(accountMembers.userId, userId));
    expect(members).toHaveLength(4);
    expect(members.every((m) => m.canRead && m.canWrite)).toBe(true);

    const seededCategories = await db
      .select()
      .from(categories)
      .where(eq(categories.createdBy, userId));
    expect(seededCategories).toHaveLength(15);

    const byKey = new Map(seededCategories.map((c) => [c.seedKey, c]));
    expect(byKey.get("adjustment")).toMatchObject({
      name: "Коригування",
      isExpense: true,
      isIncome: true,
    });
    expect(byKey.get("salary")).toMatchObject({
      name: "Зарплата",
      isExpense: false,
      isIncome: true,
    });
    expect(byKey.get("groceries")).toMatchObject({
      isExpense: true,
      isIncome: false,
    });

    const categoryMemberRows = await db
      .select()
      .from(categoryMembers)
      .where(eq(categoryMembers.userId, userId));
    expect(categoryMemberRows).toHaveLength(15);

    const logs = await db
      .select()
      .from(historyLogs)
      .where(eq(historyLogs.userId, userId));
    expect(logs).toHaveLength(19);
  });

  it("names the seed in English for an English UI", async () => {
    const { id, secret } = await createInvite();
    await registerWith(id, secret, {}, "en");

    const names = (await db.select().from(accounts)).map((a) => a.name);
    expect(new Set(names)).toEqual(new Set(["Cash"]));

    const user = await db.query.users.findFirst();
    expect(user?.locale).toBe("en");
  });

  it("makes the admin invite register an admin", async () => {
    await anonymousCaller().invites.makeOtpQR({ id: "admin", ...details });
    const secret = await adminSecret();

    await registerWith("admin", secret);

    const user = await db.query.users.findFirst();
    expect(user?.role).toBe("admin");

    // and the bootstrap is closed from now on
    await expectTRPCError(
      anonymousCaller().invites.validate({ id: "admin" }),
      "FORBIDDEN",
      "invite_invalid",
    );
  });

  it("rejects a wrong OTP", async () => {
    const { id } = await createInvite();

    await expectTRPCError(
      registerWith(id, "x", { code: "000000" }),
      "BAD_REQUEST",
      "invalid_otp",
    );

    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("accepts the code of the adjacent 30 s step", async () => {
    const { id, secret } = await createInvite();
    const previous = generateTotp(secret, Date.now() - 30_000);

    await expect(
      registerWith(id, secret, { code: previous }),
    ).resolves.toBeTruthy();
  });

  it("limits OTP attempts to 10 per invite", async () => {
    const { id, secret } = await createInvite();

    for (let i = 0; i < 10; i++) {
      await expectTRPCError(
        registerWith(id, secret, { code: "000000" }),
        "BAD_REQUEST",
        "invalid_otp",
      );
    }

    // even the right code is refused now
    await expectTRPCError(
      registerWith(id, secret),
      "TOO_MANY_REQUESTS",
      "otp_attempts_exceeded",
    );
  });

  it("re-checks email uniqueness", async () => {
    const { id, secret } = await createInvite();
    await createUser({ email: "NEW.PERSON@example.com" });

    await expectTRPCError(
      registerWith(id, secret),
      "BAD_REQUEST",
      "email_not_unique",
    );
  });

  it("refuses a second registration with the same invite", async () => {
    const { id, secret } = await createInvite();
    await registerWith(id, secret);

    await expectTRPCError(
      registerWith(id, secret, { email: "other@example.com" }),
      "FORBIDDEN",
      "invite_invalid",
    );
  });

  it("lets only one of two concurrent registrations claim the invite", async () => {
    const { id, secret } = await createInvite();

    const results = await Promise.allSettled([
      registerWith(id, secret, { email: "a@example.com" }),
      registerWith(id, secret, { email: "b@example.com" }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.select().from(users).where(isNull(users.deletedAt)),
    ).toHaveLength(1);
  });

  describe("atomicity", () => {
    afterEach(async () => {
      await db.execute(
        "DROP TRIGGER IF EXISTS fail_category_insert ON categories",
      );
      await db.execute("DROP FUNCTION IF EXISTS fail_category_insert()");
    });

    it("leaves nothing behind when a late step fails", async () => {
      const { id, secret } = await createInvite();

      // fail the category seed, which runs after the user, invite claim,
      // credentials, 2FA and accounts were written
      await db.execute(`
        CREATE FUNCTION fail_category_insert() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'injected failure'; END; $$ LANGUAGE plpgsql
      `);
      await db.execute(`
        CREATE TRIGGER fail_category_insert BEFORE INSERT ON categories
        FOR EACH ROW EXECUTE FUNCTION fail_category_insert()
      `);

      await expect(registerWith(id, secret)).rejects.toThrow();

      expect(await db.select().from(users)).toHaveLength(0);
      expect(await db.select().from(accounts)).toHaveLength(0);
      expect(await db.select().from(twoFactors)).toHaveLength(0);
      expect(await db.select().from(historyLogs)).toHaveLength(0);

      const invite = await db.query.invites.findFirst({
        where: and(eq(invites.id, id), isNull(invites.userId)),
      });
      expect(invite?.otpSecret).toBe(secret);
    });
  });
});
