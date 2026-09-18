import { and, asc, count, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { DbOrTx } from "~/server/db";
import { invites, sessions, users } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { appError, notFound } from "~/server/lib/errors";
import { randomString } from "~/server/lib/ids";
import { generateTotpSecret } from "~/server/lib/totp";
import { ADMIN_INVITE_ID } from "~/server/services/invites";

const claimedBy = alias(users, "claimed_by");
const creator = alias(users, "creator");

export const listInvites = (db: DbOrTx) =>
  db
    .select({
      id: invites.id,
      comment: invites.comment,
      userId: invites.userId,
      userName: claimedBy.name,
      createdBy: invites.createdBy,
      creatorName: creator.name,
      createdAt: invites.createdAt,
      updatedAt: invites.updatedAt,
    })
    .from(invites)
    .leftJoin(claimedBy, eq(claimedBy.id, invites.userId))
    .leftJoin(creator, eq(creator.id, invites.createdBy))
    .orderBy(desc(invites.createdAt));

export const createInvite = async (
  db: DbOrTx,
  adminId: string,
  comment: string,
) => {
  const [row] = await db
    .insert(invites)
    .values({
      id: randomString(48),
      otpSecret: generateTotpSecret(),
      comment: comment.trim(),
      createdBy: adminId,
    })
    .returning({ id: invites.id });

  return row;
};

/** Only unclaimed invites can be deleted; the admin bootstrap row is kept */
export const deleteInvite = async (db: DbOrTx, id: string) => {
  const deleted = await db
    .delete(invites)
    .where(
      and(
        eq(invites.id, id),
        isNull(invites.userId),
        ne(invites.id, ADMIN_INVITE_ID),
      ),
    )
    .returning({ id: invites.id });

  if (deleted.length === 0) {
    throw notFound();
  }
};

export const listUsers = (db: DbOrTx) =>
  db
    .select({
      id: users.id,
      name: users.name,
      email: sql<string>`coalesce(${users.deletedEmail}, ${users.email})`,
      role: users.role,
      banned: users.banned,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.id));

const activeAdminCount = async (tx: DbOrTx) => {
  const [row] = await tx
    .select({ value: count() })
    .from(users)
    .where(
      and(
        eq(users.role, "admin"),
        isNull(users.deletedAt),
        eq(users.banned, false),
      ),
    );

  return row?.value ?? 0;
};

const lockUser = async (tx: DbOrTx, userId: string) => {
  // every role/ban/delete change takes this lock first, so two admins
  // demoting each other can't both see "one other admin left"
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('zm:admins'))`);

  const [row] = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .for("update");

  if (!row) {
    throw notFound();
  }

  return row;
};

export const revokeSessions = async (
  tx: DbOrTx,
  userId: string,
  keepSessionId?: string | null,
) => {
  await tx
    .delete(sessions)
    .where(
      keepSessionId
        ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))
        : eq(sessions.userId, userId),
    );
};

/** Promote or demote; the last active admin can't be demoted */
export const setRole = (
  db: DbOrTx,
  adminId: string,
  input: { userId: string; role: "admin" | "user" },
) =>
  db.transaction(async (tx) => {
    const user = await lockUser(tx, input.userId);

    if (
      user.role === "admin" &&
      input.role === "user" &&
      !user.deletedAt &&
      !user.banned &&
      (await activeAdminCount(tx)) <= 1
    ) {
      throw appError("BAD_REQUEST", "last_admin");
    }

    await tx
      .update(users)
      .set({ role: input.role })
      .where(eq(users.id, user.id));
    await audit(tx, {
      entityType: "user",
      entityId: user.id,
      action: "update",
      userId: adminId,
      payload: { role: input.role },
    });
  });

/** Ban or unban; banned users are signed out and can't sign in */
export const setBanned = (
  db: DbOrTx,
  adminId: string,
  input: { userId: string; banned: boolean },
) =>
  db.transaction(async (tx) => {
    const user = await lockUser(tx, input.userId);

    await tx
      .update(users)
      .set({ banned: input.banned, banReason: null, banExpires: null })
      .where(eq(users.id, user.id));

    if (input.banned) {
      await revokeSessions(tx, user.id);
    }

    await audit(tx, {
      entityType: "user",
      entityId: user.id,
      action: "update",
      userId: adminId,
      payload: { banned: input.banned },
    });
  });

/**
 * Soft delete: the address moves to deletedEmail so it can be invited again,
 * and every session ends. Deleting the last admin re-opens the bootstrap.
 */
export const deleteUser = (db: DbOrTx, adminId: string, userId: string) =>
  db.transaction(async (tx) => {
    const user = await lockUser(tx, userId);

    if (user.deletedAt) {
      return;
    }

    await tx
      .update(users)
      .set({
        deletedAt: new Date(),
        deletedEmail: user.email,
        email: `${user.id}@deleted.invalid`,
      })
      .where(eq(users.id, user.id));
    await revokeSessions(tx, user.id);
    await audit(tx, {
      entityType: "user",
      entityId: user.id,
      action: "delete",
      userId: adminId,
      payload: {},
    });
  });

export const restoreUser = (db: DbOrTx, adminId: string, userId: string) =>
  db.transaction(async (tx) => {
    const user = await lockUser(tx, userId);

    if (!user.deletedAt) {
      return;
    }

    const email = user.deletedEmail ?? user.email;
    const [taken] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = lower(${email})`,
          isNull(users.deletedAt),
        ),
      );

    if (taken) {
      throw appError("BAD_REQUEST", "email_not_unique");
    }

    await tx
      .update(users)
      .set({ deletedAt: null, deletedEmail: null, email })
      .where(eq(users.id, user.id));
    await audit(tx, {
      entityType: "user",
      entityId: user.id,
      action: "restore",
      userId: adminId,
      payload: {},
    });
  });
