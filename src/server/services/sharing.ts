import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { ShareEntity } from "~/lib/validators/sharing";
import type { DbOrTx } from "~/server/db";
import { accountMembers, categoryMembers, users } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { appError, forbidden } from "~/server/lib/errors";
import { newId } from "~/server/lib/ids";
import {
  accountAccess,
  requireWritableCategory,
} from "~/server/services/access";

/**
 * Sharing works through the member tables: the owner (any member with write)
 * adds another existing user as read-only or read+write, lists and revokes
 * them. The creator's own row can't be revoked, and debt accounts are never
 * shared.
 */

const requireShareable = async (
  db: DbOrTx,
  userId: string,
  entity: ShareEntity,
  id: string,
): Promise<{ createdBy: string }> => {
  if (entity === "category") {
    const access = await requireWritableCategory(db, userId, id);

    return { createdBy: access.createdBy };
  }

  const access = (await accountAccess(db, userId, [id])).get(id);

  if (!access?.canWrite) {
    throw forbidden();
  }

  if (access.type === "debt") {
    throw appError("BAD_REQUEST", "share_debt_account");
  }

  return { createdBy: access.createdBy };
};

const membersTable = (entity: ShareEntity) =>
  entity === "account"
    ? { table: accountMembers, key: accountMembers.accountId }
    : { table: categoryMembers, key: categoryMembers.categoryId };

export const listShares = async (
  db: DbOrTx,
  userId: string,
  input: { entity: ShareEntity; id: string },
) => {
  const { createdBy } = await requireShareable(
    db,
    userId,
    input.entity,
    input.id,
  );
  const { table, key } = membersTable(input.entity);

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      canWrite: table.canWrite,
    })
    .from(table)
    .innerJoin(users, eq(users.id, table.userId))
    .where(
      and(eq(key, input.id), isNull(table.deletedAt), isNull(users.deletedAt)),
    )
    .orderBy(asc(users.name));

  return rows.map((row) => ({
    ...row,
    isOwner: row.userId === createdBy,
    isSelf: row.userId === userId,
  }));
};

export const addShare = (
  db: DbOrTx,
  userId: string,
  input: { entity: ShareEntity; id: string; email: string; canWrite: boolean },
) =>
  db.transaction(async (tx) => {
    await requireShareable(tx, userId, input.entity, input.id);

    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = ${input.email.trim().toLowerCase()}`,
          isNull(users.deletedAt),
        ),
      );

    if (!target) {
      throw appError("BAD_REQUEST", "share_user_not_found");
    }

    if (target.id === userId) {
      throw appError("BAD_REQUEST", "share_self");
    }

    // one live member row per pair: re-sharing updates the rights in place
    const rights = { canRead: true, canWrite: input.canWrite };

    if (input.entity === "account") {
      await tx
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
        });
    } else {
      await tx
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
        });
    }

    await audit(tx, {
      entityType: input.entity,
      entityId: input.id,
      action: "update",
      userId,
      payload: {
        share: { userId: target.id, canWrite: input.canWrite },
      },
    });

    return { userId: target.id };
  });

export const revokeShare = (
  db: DbOrTx,
  userId: string,
  input: { entity: ShareEntity; id: string; userId: string },
) =>
  db.transaction(async (tx) => {
    const { createdBy } = await requireShareable(
      tx,
      userId,
      input.entity,
      input.id,
    );

    if (input.userId === createdBy) {
      throw forbidden();
    }

    const { table, key } = membersTable(input.entity);

    await tx
      .update(table)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(key, input.id),
          eq(table.userId, input.userId),
          isNull(table.deletedAt),
        ),
      );

    await audit(tx, {
      entityType: input.entity,
      entityId: input.id,
      action: "update",
      userId,
      payload: { revoke: { userId: input.userId } },
    });
  });
