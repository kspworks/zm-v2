import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { anonymousCaller, callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import { createAdmin, createUser } from "../helpers/fixtures";

describe("protected procedures", () => {
  it("reject anonymous callers", async () => {
    await expectTRPCError(anonymousCaller().me.get(), "UNAUTHORIZED");
    await expectTRPCError(
      anonymousCaller().me.setLocale({ locale: "en" }),
      "UNAUTHORIZED",
    );
  });

  it("serve an active user", async () => {
    const user = await createUser();
    const me = await callerFor(user).me.get();

    expect(me).toMatchObject({ id: user.id, role: "user", build: null });
  });

  it("re-read the user, so deleting takes effect on the next call", async () => {
    const user = await createUser();
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, user.id));

    await expectTRPCError(callerFor(user).me.get(), "UNAUTHORIZED");
  });

  it("reject banned users, but not once a ban expires", async () => {
    const user = await createUser({ banned: true });
    await expectTRPCError(callerFor(user).me.get(), "UNAUTHORIZED");

    await db
      .update(users)
      .set({ banExpires: new Date(Date.now() - 1000) })
      .where(eq(users.id, user.id));
    await expect(callerFor(user).me.get()).resolves.toBeTruthy();
  });

  it("reject a session whose user no longer exists", async () => {
    await expectTRPCError(callerFor({ id: "ghost" }).me.get(), "UNAUTHORIZED");
  });

  it("show the build to admins only", async () => {
    const admin = await createAdmin();
    const me = await callerFor(admin).me.get();

    expect(me.build).toMatchObject({ env: "test" });
  });
});

describe("me.setLocale", () => {
  it("stores the locale on the profile", async () => {
    const user = await createUser({ locale: "uk" });
    await callerFor(user).me.setLocale({ locale: "en" });

    const row = await db.query.users.findFirst({
      where: eq(users.id, user.id),
    });
    expect(row?.locale).toBe("en");
  });

  it("rejects unsupported locales", async () => {
    const user = await createUser();

    await expectTRPCError(
      // @ts-expect-error: "ua" is the legacy tag
      callerFor(user).me.setLocale({ locale: "ua" }),
      "BAD_REQUEST",
    );
  });
});
