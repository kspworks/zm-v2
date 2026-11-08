import { and, asc, count, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";

import { query, transaction } from "~/server/db/database";
import { invites, sessions, users } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now } from "~/server/lib/clock";
import { badRequest, notFound } from "~/server/lib/errors";
import { randomString } from "~/server/lib/ids";
import { generateTotpSecret } from "~/server/lib/totp";
import { ADMIN_INVITE_ID } from "~/server/services/invites";

const claimedBy = alias(users, "claimed_by");
const creator = alias(users, "creator");

export const listInvites = Effect.fn("admin.listInvites")(function* () {
  return yield* query((db) =>
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
      .orderBy(desc(invites.createdAt)),
  );
});

export const createInvite = Effect.fn("admin.createInvite")(function* (
  adminId: string,
  comment: string,
) {
  const [row] = yield* query((db) =>
    db
      .insert(invites)
      .values({
        id: randomString(48),
        otpSecret: generateTotpSecret(),
        comment: comment.trim(),
        createdBy: adminId,
      })
      .returning({ id: invites.id }),
  );

  return row;
});

/** Only unclaimed invites can be deleted; the admin bootstrap row is kept */
export const deleteInvite = Effect.fn("admin.deleteInvite")(function* (
  id: string,
) {
  const deleted = yield* query((db) =>
    db
      .delete(invites)
      .where(
        and(
          eq(invites.id, id),
          isNull(invites.userId),
          ne(invites.id, ADMIN_INVITE_ID),
        ),
      )
      .returning({ id: invites.id }),
  );

  if (deleted.length === 0) {
    return yield* notFound();
  }
});

export const listUsers = Effect.fn("admin.listUsers")(function* () {
  return yield* query((db) =>
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
      .orderBy(asc(users.createdAt), asc(users.id)),
  );
});

const activeAdminCount = Effect.fnUntraced(function* () {
  const [row] = yield* query((db) =>
    db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          eq(users.role, "admin"),
          isNull(users.deletedAt),
          eq(users.banned, false),
        ),
      ),
  );

  return row?.value ?? 0;
});

const lockUser = Effect.fnUntraced(function* (userId: string) {
  // every role/ban/delete change takes this lock first, so two admins
  // demoting each other can't both see "one other admin left"
  yield* query((db) =>
    db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('zm:admins'))`),
  );

  const [row] = yield* query((db) =>
    db.select().from(users).where(eq(users.id, userId)).for("update"),
  );

  if (!row) {
    return yield* notFound();
  }

  return row;
});

/** Ends the user's sessions, optionally keeping the current one */
export const revokeSessions = Effect.fn("admin.revokeSessions")(function* (
  userId: string,
  keepSessionId?: string | null,
) {
  yield* query((db) =>
    db
      .delete(sessions)
      .where(
        keepSessionId
          ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))
          : eq(sessions.userId, userId),
      ),
  );
});

/**
 * Fails with `last_admin` when the (locked) user is the only active admin.
 * Demoting, banning or deleting them would leave no admin, and with none the
 * public admin bootstrap re-opens to anyone.
 */
const refuseLastAdmin = Effect.fnUntraced(function* (
  user: typeof users.$inferSelect,
) {
  if (
    user.role === "admin" &&
    !user.deletedAt &&
    !user.banned &&
    (yield* activeAdminCount()) <= 1
  ) {
    return yield* badRequest("last_admin");
  }
});

/** Promote or demote; the last active admin can't be demoted */
export const setRole = Effect.fn("admin.setRole")(function* (
  adminId: string,
  input: { userId: string; role: "admin" | "user" },
) {
  const user = yield* lockUser(input.userId);

  if (input.role === "user") {
    yield* refuseLastAdmin(user);
  }

  yield* query((db) =>
    db.update(users).set({ role: input.role }).where(eq(users.id, user.id)),
  );
  yield* audit({
    entityType: "user",
    entityId: user.id,
    action: "update",
    userId: adminId,
    payload: { role: input.role },
  });
}, transaction);

/**
 * Ban or unban; banned users are signed out and can't sign in. The last
 * active admin can't be banned.
 */
export const setBanned = Effect.fn("admin.setBanned")(function* (
  adminId: string,
  input: { userId: string; banned: boolean },
) {
  const user = yield* lockUser(input.userId);

  if (input.banned) {
    yield* refuseLastAdmin(user);
  }

  yield* query((db) =>
    db
      .update(users)
      .set({ banned: input.banned, banReason: null, banExpires: null })
      .where(eq(users.id, user.id)),
  );

  if (input.banned) {
    yield* revokeSessions(user.id);
  }

  yield* audit({
    entityType: "user",
    entityId: user.id,
    action: "update",
    userId: adminId,
    payload: { banned: input.banned },
  });
}, transaction);

/**
 * Soft delete: the address moves to deletedEmail so it can be invited again,
 * and every session ends. The last active admin can't be deleted.
 */
export const deleteUser = Effect.fn("admin.deleteUser")(function* (
  adminId: string,
  userId: string,
) {
  const user = yield* lockUser(userId);

  if (user.deletedAt) {
    return;
  }

  yield* refuseLastAdmin(user);

  const at = yield* now;

  yield* query((db) =>
    db
      .update(users)
      .set({
        deletedAt: at,
        deletedEmail: user.email,
        email: `${user.id}@deleted.invalid`,
      })
      .where(eq(users.id, user.id)),
  );
  yield* revokeSessions(user.id);
  yield* audit({
    entityType: "user",
    entityId: user.id,
    action: "delete",
    userId: adminId,
    payload: {},
  });
}, transaction);

export const restoreUser = Effect.fn("admin.restoreUser")(function* (
  adminId: string,
  userId: string,
) {
  const user = yield* lockUser(userId);

  if (!user.deletedAt) {
    return;
  }

  const email = user.deletedEmail ?? user.email;
  const [taken] = yield* query((db) =>
    db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = lower(${email})`,
          isNull(users.deletedAt),
        ),
      ),
  );

  if (taken) {
    return yield* badRequest("email_not_unique");
  }

  yield* query((db) =>
    db
      .update(users)
      .set({ deletedAt: null, deletedEmail: null, email })
      .where(eq(users.id, user.id)),
  );
  yield* audit({
    entityType: "user",
    entityId: user.id,
    action: "restore",
    userId: adminId,
    payload: {},
  });
}, transaction);
