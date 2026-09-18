import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import { accountMembers } from "~/server/db/schema";
import { getOrCreateDebtAccount } from "~/server/services/accounts";
import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import {
  CURRENCY,
  createUser,
  grant,
  makeAccount,
  makeCategory,
} from "../helpers/fixtures";

describe("sharing an account", () => {
  it("adds another user by email as read-only", async () => {
    const owner = await createUser();
    const friend = await createUser({ email: "friend@example.com" });
    const account = await makeAccount(owner, { name: "Family" });

    await callerFor(owner).sharing.add({
      entity: "account",
      id: account.id,
      email: "FRIEND@example.com",
      canWrite: false,
    });

    const [row] = await callerFor(friend).accounts.list();
    expect(row).toMatchObject({ id: account.id, canWrite: false });

    await expectTRPCError(
      callerFor(friend).accounts.update({
        id: account.id,
        name: "Hijacked",
        currencyId: CURRENCY.UAH,
      }),
      "FORBIDDEN",
    );
  });

  it("grants write when asked, and re-sharing updates the rights in place", async () => {
    const owner = await createUser();
    const friend = await createUser();
    const account = await makeAccount(owner);
    const share = (canWrite: boolean) =>
      callerFor(owner).sharing.add({
        entity: "account",
        id: account.id,
        email: friend.email,
        canWrite,
      });

    await share(false);
    await share(true);

    const members = await db
      .select()
      .from(accountMembers)
      .where(
        and(
          eq(accountMembers.accountId, account.id),
          eq(accountMembers.userId, friend.id),
          isNull(accountMembers.deletedAt),
        ),
      );
    expect(members).toHaveLength(1);
    expect(members[0]?.canWrite).toBe(true);
  });

  it("lists members with the owner marked", async () => {
    const owner = await createUser({ name: "A Owner" });
    const friend = await createUser({ name: "B Friend" });
    const account = await makeAccount(owner);
    await grant("account", account.id, friend);

    const rows = await callerFor(owner).sharing.list({
      entity: "account",
      id: account.id,
    });

    expect(rows).toMatchObject([
      { userId: owner.id, isOwner: true, isSelf: true, canWrite: true },
      { userId: friend.id, isOwner: false, isSelf: false, canWrite: false },
    ]);
  });

  it("revokes a member, but never the creator", async () => {
    const owner = await createUser();
    const friend = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, friend, { canWrite: true });

    await expectTRPCError(
      callerFor(friend).sharing.revoke({
        entity: "account",
        id: account.id,
        userId: owner.id,
      }),
      "FORBIDDEN",
    );

    await callerFor(owner).sharing.revoke({
      entity: "account",
      id: account.id,
      userId: friend.id,
    });

    expect(await callerFor(friend).accounts.list()).toEqual([]);
  });

  it("needs write access to share, list or revoke", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const third = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, reader);

    await expectTRPCError(
      callerFor(reader).sharing.add({
        entity: "account",
        id: account.id,
        email: third.email,
        canWrite: true,
      }),
      "FORBIDDEN",
    );
    await expectTRPCError(
      callerFor(reader).sharing.list({ entity: "account", id: account.id }),
      "FORBIDDEN",
    );
    await expectTRPCError(
      callerFor(third).sharing.list({ entity: "account", id: account.id }),
      "FORBIDDEN",
    );
  });

  it("rejects unknown emails, oneself and debt accounts", async () => {
    const owner = await createUser();
    const account = await makeAccount(owner);

    await expectTRPCError(
      callerFor(owner).sharing.add({
        entity: "account",
        id: account.id,
        email: "nobody@example.com",
        canWrite: false,
      }),
      "BAD_REQUEST",
      "share_user_not_found",
    );
    await expectTRPCError(
      callerFor(owner).sharing.add({
        entity: "account",
        id: account.id,
        email: owner.email,
        canWrite: false,
      }),
      "BAD_REQUEST",
      "share_self",
    );

    const debt = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, owner.id, CURRENCY.UAH),
    );
    await expectTRPCError(
      callerFor(owner).sharing.add({
        entity: "account",
        id: debt,
        email: (await createUser()).email,
        canWrite: false,
      }),
      "BAD_REQUEST",
      "share_debt_account",
    );
  });

  it("does not share with a soft-deleted user", async () => {
    const owner = await createUser();
    const gone = await createUser({ deletedAt: new Date() });
    const account = await makeAccount(owner);

    await expectTRPCError(
      callerFor(owner).sharing.add({
        entity: "account",
        id: account.id,
        email: gone.email,
        canWrite: false,
      }),
      "BAD_REQUEST",
      "share_user_not_found",
    );
  });
});

describe("sharing a category", () => {
  it("shares read-only and read+write", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const writer = await createUser();
    const category = await makeCategory(owner, { name: "Groceries" });

    await callerFor(owner).sharing.add({
      entity: "category",
      id: category.id,
      email: reader.email,
      canWrite: false,
    });
    await callerFor(owner).sharing.add({
      entity: "category",
      id: category.id,
      email: writer.email,
      canWrite: true,
    });

    expect(await callerFor(reader).categories.list()).toMatchObject([
      { id: category.id, canWrite: false },
    ]);

    await expectTRPCError(
      callerFor(reader).categories.update({ id: category.id, name: "X" }),
      "FORBIDDEN",
    );
    await expect(
      callerFor(writer).categories.update({ id: category.id, name: "X" }),
    ).resolves.toBeTruthy();
  });
});
