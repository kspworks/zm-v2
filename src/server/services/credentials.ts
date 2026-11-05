import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

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
import { query, transaction } from "~/server/db/database";
import { authAccounts, users } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { badRequest, notFound } from "~/server/lib/errors";
import { revokeSessions } from "~/server/services/admin";

/*
 * Self-service credential changes. A password change and new backup codes
 * need the current password and a TOTP code; re-enrolling needs the password
 * and a TOTP or backup code, then a code from the new secret. A password
 * change or re-enrolment revokes the user's other sessions. All are audited.
 */

const credentialOf = Effect.fnUntraced(function* (userId: string) {
  const [row] = yield* query((db) =>
    db
      .select()
      .from(authAccounts)
      .where(
        and(
          eq(authAccounts.userId, userId),
          eq(authAccounts.providerId, "credential"),
        ),
      )
      .for("update"),
  );

  if (!row?.password) {
    return yield* notFound();
  }

  return row;
});

export const requirePassword = Effect.fn("credentials.requirePassword")(
  function* (userId: string, password: string) {
    const credential = yield* credentialOf(userId);

    if (!(yield* verifyPasswordHash(credential.password ?? "", password))) {
      return yield* badRequest("invalid_password");
    }

    return credential;
  },
);

const requireCode = Effect.fnUntraced(function* (
  userId: string,
  code: string,
  allowBackupCode: boolean,
) {
  if (!(yield* verifySecondFactor(userId, code, { allowBackupCode }))) {
    return yield* badRequest("invalid_code");
  }
});

export const setPassword = Effect.fn("credentials.setPassword")(function* (
  userId: string,
  newPassword: string,
) {
  const credential = yield* credentialOf(userId);
  const password = yield* hashPassword(newPassword);

  yield* query((db) =>
    db
      .update(authAccounts)
      .set({ password })
      .where(eq(authAccounts.id, credential.id)),
  );
});

const userEmail = Effect.fnUntraced(function* (userId: string) {
  const [row] = yield* query((db) =>
    db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt))),
  );

  if (!row) {
    return yield* notFound();
  }

  return row.email;
});

export const changePassword = Effect.fn("credentials.changePassword")(
  function* (
    user: { id: string; sessionId: string | null },
    input: { currentPassword: string; newPassword: string; code: string },
  ) {
    yield* requirePassword(user.id, input.currentPassword);
    yield* requireCode(user.id, input.code, false);
    yield* setPassword(user.id, input.newPassword);
    yield* revokeSessions(user.id, user.sessionId);
    yield* audit({
      entityType: "user",
      entityId: user.id,
      action: "update",
      userId: user.id,
      payload: { passwordChanged: true },
    });
  },
  transaction,
);

const reenrolKey = (userId: string) => `zm-reenrol:${userId}`;

export const startReenrol = Effect.fn("credentials.startReenrol")(function* (
  userId: string,
  input: { password: string; code: string },
) {
  yield* requirePassword(userId, input.password);
  yield* requireCode(userId, input.code, true);

  return yield* startPendingEnrolment(
    reenrolKey(userId),
    yield* userEmail(userId),
  );
}, transaction);

export const confirmReenrol = Effect.fn("credentials.confirmReenrol")(
  function* (user: { id: string; sessionId: string | null }, code: string) {
    const secret = yield* confirmPendingEnrolment(reenrolKey(user.id), code);

    if (!secret) {
      return yield* badRequest("invalid_code");
    }

    const backupCodes = yield* enrolTwoFactor(user.id, secret);
    yield* revokeSessions(user.id, user.sessionId);
    yield* audit({
      entityType: "user",
      entityId: user.id,
      action: "update",
      userId: user.id,
      payload: { twoFactorReenrolled: true },
    });

    return { backupCodes };
  },
  transaction,
);

export const newBackupCodes = Effect.fn("credentials.newBackupCodes")(
  function* (userId: string, input: { password: string; code: string }) {
    yield* requirePassword(userId, input.password);
    yield* requireCode(userId, input.code, false);

    const backupCodes = yield* regenerateBackupCodes(userId);
    yield* audit({
      entityType: "user",
      entityId: userId,
      action: "update",
      userId,
      payload: { backupCodesRegenerated: true },
    });

    return { backupCodes };
  },
  transaction,
);
