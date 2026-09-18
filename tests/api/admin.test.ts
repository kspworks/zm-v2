import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import { invites, sessions, users } from "~/server/db/schema";
import { generateTotp } from "~/server/lib/totp";
import { AuthSession } from "../helpers/auth-http";
import { anonymousCaller, callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import {
  createAdmin,
  createUser,
  createUserWithCredentials,
} from "../helpers/fixtures";

type Caller = ReturnType<typeof callerFor>;

const ADMIN_ONLY: [string, (c: Caller) => Promise<unknown>][] = [
  ["admin.invites", (c) => c.admin.invites()],
  ["admin.createInvite", (c) => c.admin.createInvite({ comment: "x" })],
  ["admin.deleteInvite", (c) => c.admin.deleteInvite({ id: "x" })],
  ["admin.users", (c) => c.admin.users()],
  ["admin.setRole", (c) => c.admin.setRole({ userId: "x", role: "admin" })],
  ["admin.setBanned", (c) => c.admin.setBanned({ userId: "x", banned: true })],
  ["admin.deleteUser", (c) => c.admin.deleteUser({ userId: "x" })],
  ["admin.restoreUser", (c) => c.admin.restoreUser({ userId: "x" })],
  ["admin.revokeSessions", (c) => c.admin.revokeSessions({ userId: "x" })],
  ["admin.recoveryLinks", (c) => c.admin.recoveryLinks({ userId: "x" })],
  [
    "admin.createRecoveryLink",
    (c) => c.admin.createRecoveryLink({ userId: "x", scope: "both" }),
  ],
  ["admin.revokeRecoveryLink", (c) => c.admin.revokeRecoveryLink({ id: "x" })],
];

describe("admin procedures", () => {
  it.each(ADMIN_ONLY)(
    "%s: UNAUTHORIZED anonymously, FORBIDDEN for users",
    async (_n, call) => {
      await expectTRPCError(call(anonymousCaller()), "UNAUTHORIZED");
      await expectTRPCError(call(callerFor(await createUser())), "FORBIDDEN");
    },
  );

  it("take the role from the database on every call", async () => {
    const admin = await createAdmin();
    await callerFor(admin).admin.users();

    await db.update(users).set({ role: "user" }).where(eq(users.id, admin.id));
    await expectTRPCError(callerFor(admin).admin.users(), "FORBIDDEN");
  });
});

describe("invites", () => {
  it("creates a 48-char invite with a TOTP secret that registration accepts", async () => {
    const admin = await createAdmin({ name: "Boss" });
    const created = await callerFor(admin).admin.createInvite({
      comment: " for Olena ",
    });

    expect(created?.id).toHaveLength(48);
    expect(
      await anonymousCaller().invites.validate({ id: created?.id ?? "" }),
    ).toEqual({
      isAdmin: false,
    });

    const [row] = await callerFor(admin).admin.invites();
    expect(row).toMatchObject({
      comment: "for Olena",
      creatorName: "Boss",
      userId: null,
    });
  });

  it("requires a comment of at most 255 chars", async () => {
    const admin = await createAdmin();

    await expectTRPCError(
      callerFor(admin).admin.createInvite({ comment: " " }),
      "BAD_REQUEST",
    );
    await expectTRPCError(
      callerFor(admin).admin.createInvite({ comment: "x".repeat(256) }),
      "BAD_REQUEST",
    );
  });

  it("deletes unclaimed invites only", async () => {
    const admin = await createAdmin();
    const open = await callerFor(admin).admin.createInvite({ comment: "a" });
    await db
      .insert(invites)
      .values({ id: "claimed", userId: admin.id, createdBy: admin.id });

    await callerFor(admin).admin.deleteInvite({ id: open?.id ?? "" });
    await expectTRPCError(
      callerFor(admin).admin.deleteInvite({ id: "claimed" }),
      "NOT_FOUND",
    );

    expect((await callerFor(admin).admin.invites()).map((i) => i.id)).toEqual([
      "claimed",
    ]);
  });
});

describe("users", () => {
  it("lists users, showing a deleted user's original email", async () => {
    const admin = await createAdmin();
    const user = await createUser({ email: "gone@example.com" });
    await callerFor(admin).admin.deleteUser({ userId: user.id });

    const rows = await callerFor(admin).admin.users();
    expect(rows.find((r) => r.id === user.id)).toMatchObject({
      email: "gone@example.com",
      deletedAt: expect.any(Date),
    });
  });

  it("never demotes the last active admin", async () => {
    const admin = await createAdmin();

    await expectTRPCError(
      callerFor(admin).admin.setRole({ userId: admin.id, role: "user" }),
      "BAD_REQUEST",
      "last_admin",
    );

    const second = await createAdmin();
    await callerFor(admin).admin.setRole({ userId: second.id, role: "user" });
    await callerFor(admin).admin.setRole({ userId: second.id, role: "admin" });
    await callerFor(second).admin.setRole({ userId: admin.id, role: "user" });

    expect(
      (await db.query.users.findFirst({ where: eq(users.id, admin.id) }))?.role,
    ).toBe("user");
  });

  it("bans and unbans, ending the user's sessions", async () => {
    const admin = await createAdmin();
    const { user, password, secret } = await createUserWithCredentials();
    const browser = new AuthSession();
    await browser.post("/sign-in/email", { email: user.email, password });
    await browser.post("/two-factor/verify-totp", {
      code: generateTotp(secret),
    });
    expect(await browser.session()).not.toBeNull();

    await callerFor(admin).admin.setBanned({ userId: user.id, banned: true });

    expect(await browser.session()).toBeNull();
    await expectTRPCError(callerFor(user).me.get(), "UNAUTHORIZED");

    await callerFor(admin).admin.setBanned({ userId: user.id, banned: false });
    await expect(callerFor(user).me.get()).resolves.toBeTruthy();
  });

  it("soft-deletes a user, freeing the email, and restores them", async () => {
    const admin = await createAdmin();
    const user = await createUser({ email: "person@example.com" });
    await db.insert(sessions).values({
      token: "t1",
      userId: user.id,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    await callerFor(admin).admin.deleteUser({ userId: user.id });

    expect(await db.select().from(sessions)).toEqual([]);
    await expectTRPCError(callerFor(user).me.get(), "UNAUTHORIZED");

    // the address can be invited again
    const invite = await callerFor(admin).admin.createInvite({
      comment: "again",
    });
    await expect(
      anonymousCaller().invites.makeOtpQR({
        id: invite?.id ?? "",
        name: "Again",
        email: "person@example.com",
        password: "secret123",
      }),
    ).resolves.toBeTruthy();

    await callerFor(admin).admin.restoreUser({ userId: user.id });
    const row = await db.query.users.findFirst({
      where: eq(users.id, user.id),
    });
    expect(row).toMatchObject({
      email: "person@example.com",
      deletedAt: null,
      deletedEmail: null,
    });
  });

  it("refuses to restore when the email is taken again", async () => {
    const admin = await createAdmin();
    const user = await createUser({ email: "dup@example.com" });
    await callerFor(admin).admin.deleteUser({ userId: user.id });
    await createUser({ email: "DUP@example.com" });

    await expectTRPCError(
      callerFor(admin).admin.restoreUser({ userId: user.id }),
      "BAD_REQUEST",
      "email_not_unique",
    );
  });

  it("re-opens the admin bootstrap when the last admin is deleted", async () => {
    const admin = await createAdmin();
    await expectTRPCError(
      anonymousCaller().invites.validate({ id: "admin" }),
      "FORBIDDEN",
    );

    await callerFor(admin).admin.deleteUser({ userId: admin.id });

    expect(await anonymousCaller().invites.validate({ id: "admin" })).toEqual({
      isAdmin: true,
    });
  });

  it("revokes all of a user's sessions", async () => {
    const admin = await createAdmin();
    const user = await createUser();
    await db.insert(sessions).values([
      {
        token: "a",
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600_000),
      },
      {
        token: "b",
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    ]);

    await callerFor(admin).admin.revokeSessions({ userId: user.id });

    expect(await db.select().from(sessions)).toEqual([]);
  });
});
