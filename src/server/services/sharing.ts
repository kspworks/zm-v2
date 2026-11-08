import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { ShareEntity } from "~/lib/validators/sharing";
import { query, transaction } from "~/server/db/database";
import { accountMembers, categoryMembers, users } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now } from "~/server/lib/clock";
import { badRequest, forbidden } from "~/server/lib/errors";
import { newId } from "~/server/lib/ids";
import {
  accountAccess,
  requireWritableCategory,
} from "~/server/services/access";

/**
 * Sharing works through the member tables. Any member with write access can
 * list the members; only the creator (the owner) can add another existing
 * user as read-only or read+write and revoke them, so a shared writer can't
 * pass access on. The creator's own row can't be revoked, and debt accounts
 * are never shared.
 */

const requireShareable = Effect.fnUntraced(function* (
  userId: string,
  entity: ShareEntity,
  id: string,
) {
  if (entity === "category") {
    const access = yield* requireWritableCategory(userId, id);

    return { createdBy: access.createdBy };
  }

  const access = (yield* accountAccess(userId, [id])).get(id);

  if (!access?.canWrite) {
    return yield* forbidden();
  }

  if (access.type === "debt") {
    return yield* badRequest("share_debt_account");
  }

  return { createdBy: access.createdBy };
});

/** Who may change the members: the owner only */
const requireShareOwner = Effect.fnUntraced(function* (
  userId: string,
  entity: ShareEntity,
  id: string,
) {
  const { createdBy } = yield* requireShareable(userId, entity, id);

  if (createdBy !== userId) {
    return yield* forbidden();
  }

  return { createdBy };
});

const membersTable = (entity: ShareEntity) =>
  entity === "account"
    ? { table: accountMembers, key: accountMembers.accountId }
    : { table: categoryMembers, key: categoryMembers.categoryId };

export const listShares = Effect.fn("sharing.list")(function* (
  userId: string,
  input: { entity: ShareEntity; id: string },
) {
  const { createdBy } = yield* requireShareable(userId, input.entity, input.id);
  const { table, key } = membersTable(input.entity);

  const rows = yield* query((db) =>
    db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        canWrite: table.canWrite,
      })
      .from(table)
      .innerJoin(users, eq(users.id, table.userId))
      .where(
        and(
          eq(key, input.id),
          isNull(table.deletedAt),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(asc(users.name)),
  );

  return rows.map((row) => ({
    ...row,
    isOwner: row.userId === createdBy,
    isSelf: row.userId === userId,
  }));
});

export const addShare = Effect.fn("sharing.add")(function* (
  userId: string,
  input: {
    entity: ShareEntity;
    id: string;
    email: string;
    canWrite: boolean;
  },
) {
  yield* requireShareOwner(userId, input.entity, input.id);

  const [target] = yield* query((db) =>
    db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = ${input.email.trim().toLowerCase()}`,
          isNull(users.deletedAt),
        ),
      ),
  );

  if (!target) {
    return yield* badRequest("share_user_not_found");
  }

  if (target.id === userId) {
    return yield* badRequest("share_self");
  }

  // one live member row per pair: re-sharing updates the rights in place
  const rights = { canRead: true, canWrite: input.canWrite };

  if (input.entity === "account") {
    yield* query((db) =>
      db
        .insert(accountMembers)
        .values({
          id: newId(),
          accountId: input.id,
          userId: target.id,
          ...rights,
        })
        .onConflictDoUpdate({
          target: [accountMembers.accountId, accountMembers.userId],
          targetWhere: isNull(accountMembers.deletedAt),
          set: rights,
        }),
    );
  } else {
    yield* query((db) =>
      db
        .insert(categoryMembers)
        .values({
          id: newId(),
          categoryId: input.id,
          userId: target.id,
          ...rights,
        })
        .onConflictDoUpdate({
          target: [categoryMembers.categoryId, categoryMembers.userId],
          targetWhere: isNull(categoryMembers.deletedAt),
          set: rights,
        }),
    );
  }

  yield* audit({
    entityType: input.entity,
    entityId: input.id,
    action: "update",
    userId,
    payload: {
      share: { userId: target.id, canWrite: input.canWrite },
    },
  });

  return { userId: target.id };
}, transaction);

export const revokeShare = Effect.fn("sharing.revoke")(function* (
  userId: string,
  input: { entity: ShareEntity; id: string; userId: string },
) {
  const { createdBy } = yield* requireShareOwner(
    userId,
    input.entity,
    input.id,
  );

  if (input.userId === createdBy) {
    return yield* forbidden();
  }

  const { table, key } = membersTable(input.entity);
  const at = yield* now;

  yield* query((db) =>
    db
      .update(table)
      .set({ deletedAt: at })
      .where(
        and(
          eq(key, input.id),
          eq(table.userId, input.userId),
          isNull(table.deletedAt),
        ),
      ),
  );

  yield* audit({
    entityType: input.entity,
    entityId: input.id,
    action: "update",
    userId,
    payload: { revoke: { userId: input.userId } },
  });
}, transaction);
