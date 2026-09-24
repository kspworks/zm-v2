import { and, eq, isNull } from "drizzle-orm";

import {
  confirmPendingEnrolment,
  startPendingEnrolment,
} from "~/server/auth/pending-enrolment";
import {
  enrolTwoFactor,
  hashPassword,
  regenerateBackupCodes,
  verifyPasswordHash,
  verifySecondFactor,
} from "~/server/auth/two-factor";
import type { DbOrTx } from "~/server/db";
import { authAccounts, users } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { appError, notFound } from "~/server/lib/errors";
import { revokeSessions } from "~/server/services/admin";

/*
 * Self-service credential changes. A password change and new backup codes
 * need the current password and a TOTP code; re-enrolling needs the password
 * and a TOTP or backup code, then a code from the new secret. A password
 * change or re-enrolment revokes the user's other sessions. All are audited.
 */

const credentialOf = async (tx: DbOrTx, userId: string) => {
  const [row] = await tx
    .select()
    .from(authAccounts)
    .where(
      and(
        eq(authAccounts.userId, userId),
        eq(authAccounts.providerId, "credential"),
      ),
    )
    .for("update");

  if (!row?.password) {
    throw notFound();
  }

  return row;
};

export const requirePassword = async (
  tx: DbOrTx,
  userId: string,
  password: string,
) => {
  const credential = await credentialOf(tx, userId);

  if (!(await verifyPasswordHash(credential.password ?? "", password))) {
    throw appError("BAD_REQUEST", "invalid_password");
  }

  return credential;
};

const requireCode = async (
  tx: DbOrTx,
  userId: string,
  code: string,
  allowBackupCode: boolean,
) => {
  if (!(await verifySecondFactor(tx, userId, code, { allowBackupCode }))) {
    throw appError("BAD_REQUEST", "invalid_code");
  }
};

export const setPassword = async (
  tx: DbOrTx,
  userId: string,
  newPassword: string,
) => {
  const credential = await credentialOf(tx, userId);

  await tx
    .update(authAccounts)
    .set({ password: await hashPassword(newPassword) })
    .where(eq(authAccounts.id, credential.id));
};

const userEmail = async (tx: DbOrTx, userId: string) => {
  const [row] = await tx
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));

  if (!row) {
    throw notFound();
  }

  return row.email;
};

export const changePassword = (
  db: DbOrTx,
  user: { id: string; sessionId: string | null },
  input: { currentPassword: string; newPassword: string; code: string },
) =>
  db.transaction(async (tx) => {
    await requirePassword(tx, user.id, input.currentPassword);
    await requireCode(tx, user.id, input.code, false);
    await setPassword(tx, user.id, input.newPassword);
    await revokeSessions(tx, user.id, user.sessionId);
    await audit(tx, {
      entityType: "user",
      entityId: user.id,
      action: "update",
      userId: user.id,
      payload: { passwordChanged: true },
    });
  });

const reenrolKey = (userId: string) => `zm-reenrol:${userId}`;

export const startReenrol = (
  db: DbOrTx,
  userId: string,
  input: { password: string; code: string },
) =>
  db.transaction(async (tx) => {
    await requirePassword(tx, userId, input.password);
    await requireCode(tx, userId, input.code, true);

    return startPendingEnrolment(
      tx,
      reenrolKey(userId),
      await userEmail(tx, userId),
    );
  });

export const confirmReenrol = (
  db: DbOrTx,
  user: { id: string; sessionId: string | null },
  code: string,
) =>
  db.transaction(async (tx) => {
    const secret = await confirmPendingEnrolment(tx, reenrolKey(user.id), code);

    if (!secret) {
      throw appError("BAD_REQUEST", "invalid_code");
    }

    const backupCodes = await enrolTwoFactor(tx, user.id, secret);
    await revokeSessions(tx, user.id, user.sessionId);
    await audit(tx, {
      entityType: "user",
      entityId: user.id,
      action: "update",
      userId: user.id,
      payload: { twoFactorReenrolled: true },
    });

    return { backupCodes };
  });

export const newBackupCodes = (
  db: DbOrTx,
  userId: string,
  input: { password: string; code: string },
) =>
  db.transaction(async (tx) => {
    await requirePassword(tx, userId, input.password);
    await requireCode(tx, userId, input.code, false);

    const backupCodes = await regenerateBackupCodes(tx, userId);
    await audit(tx, {
      entityType: "user",
      entityId: userId,
      action: "update",
      userId,
      payload: { backupCodesRegenerated: true },
    });

    return { backupCodes };
  });
