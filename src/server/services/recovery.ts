import { and, desc, eq, gt, isNull } from "drizzle-orm";

import {
  confirmPendingEnrolment,
  startPendingEnrolment,
} from "~/server/auth/pending-enrolment";
import { issueSignInTicket } from "~/server/auth/sign-in-ticket";
import { enrolTwoFactor } from "~/server/auth/two-factor";
import type { DbOrTx } from "~/server/db";
import { recoveryLinks, users } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now } from "~/server/lib/clock";
import { appError, notFound } from "~/server/lib/errors";
import { randomString } from "~/server/lib/ids";
import {
  hitRateLimit,
  RATE_LIMITS,
  rateLimitKeys,
} from "~/server/lib/rate-limit";
import { sha256 } from "~/server/lib/tokens";
import { revokeSessions } from "~/server/services/admin";
import { requirePassword, setPassword } from "~/server/services/credentials";

export type RecoveryScope = "password" | "twoFactor" | "both";

const TTL_MS = 24 * 60 * 60_000;

/**
 * An admin-issued, single-use recovery link (stored hashed, 24 h). Creating
 * one revokes the user's previous unused link. The raw token is returned
 * once, inside the URL.
 */
export const createRecoveryLink = (
  db: DbOrTx,
  adminId: string,
  input: { userId: string; scope: RecoveryScope; origin: string },
) =>
  db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)));

    if (!user) {
      throw notFound();
    }

    await tx
      .update(recoveryLinks)
      .set({ revokedAt: now() })
      .where(
        and(
          eq(recoveryLinks.userId, user.id),
          isNull(recoveryLinks.usedAt),
          isNull(recoveryLinks.revokedAt),
        ),
      );

    const token = randomString(48);
    const [link] = await tx
      .insert(recoveryLinks)
      .values({
        userId: user.id,
        tokenHash: sha256(token),
        scope: input.scope,
        createdBy: adminId,
        expiresAt: new Date(now().getTime() + TTL_MS),
        createdAt: now(),
      })
      .returning({ id: recoveryLinks.id, expiresAt: recoveryLinks.expiresAt });

    await audit(tx, {
      entityType: "user",
      entityId: user.id,
      action: "update",
      userId: adminId,
      payload: { recoveryLink: { scope: input.scope } },
    });

    return {
      id: link?.id ?? "",
      expiresAt: link?.expiresAt,
      url: `${input.origin}/auth/recover?token=${token}`,
    };
  });

/** Unused, unrevoked, unexpired links of a user */
export const listRecoveryLinks = (db: DbOrTx, userId: string) =>
  db
    .select({
      id: recoveryLinks.id,
      scope: recoveryLinks.scope,
      createdAt: recoveryLinks.createdAt,
      expiresAt: recoveryLinks.expiresAt,
    })
    .from(recoveryLinks)
    .where(
      and(
        eq(recoveryLinks.userId, userId),
        isNull(recoveryLinks.usedAt),
        isNull(recoveryLinks.revokedAt),
        gt(recoveryLinks.expiresAt, now()),
      ),
    )
    .orderBy(desc(recoveryLinks.createdAt));

export const revokeRecoveryLink = async (db: DbOrTx, id: string) => {
  await db
    .update(recoveryLinks)
    .set({ revokedAt: now() })
    .where(and(eq(recoveryLinks.id, id), isNull(recoveryLinks.usedAt)));
};

/** A usable link for a raw token; `lock` (inside a transaction) locks it */
const findLink = async (tx: DbOrTx, token: string, lock = false) => {
  const query = tx
    .select({
      link: recoveryLinks,
      name: users.name,
      email: users.email,
    })
    .from(recoveryLinks)
    .innerJoin(users, eq(users.id, recoveryLinks.userId))
    .where(
      and(
        eq(recoveryLinks.tokenHash, sha256(token)),
        isNull(recoveryLinks.usedAt),
        isNull(recoveryLinks.revokedAt),
        gt(recoveryLinks.expiresAt, now()),
        isNull(users.deletedAt),
      ),
    );
  const [row] = lock
    ? await query.for("update", { of: recoveryLinks })
    : await query;

  if (!row) {
    throw appError("FORBIDDEN", "recovery_link_invalid");
  }

  return row;
};

export const validateRecoveryLink = async (db: DbOrTx, token: string) => {
  const { link, name, email } = await findLink(db, token);

  return { scope: link.scope, name, email };
};

const enrolKey = (linkId: string) => `zm-recover-enrol:${linkId}`;

/** Starts the fresh TOTP enrolment for a 2FA-scoped link */
export const startRecoveryEnrolment = (db: DbOrTx, token: string) =>
  db.transaction(async (tx) => {
    const { link, email } = await findLink(tx, token, true);

    if (link.scope === "password") {
      throw appError("FORBIDDEN", "recovery_link_invalid");
    }

    return startPendingEnrolment(tx, enrolKey(link.id), email);
  });

/**
 * Completes a recovery link: a new password and/or a new authenticator,
 * as the scope says. A 2FA-only link still needs the current password.
 * The link is single use; every session of the user is revoked. When the
 * user proved both factors, a sign-in ticket is returned.
 */
export const completeRecovery = async (
  db: DbOrTx,
  input: {
    token: string;
    newPassword?: string | null;
    currentPassword?: string | null;
    code?: string | null;
  },
) => {
  // count attempts per link (the id is looked up first, outside the tx)
  const { link: peek } = await findLink(db, input.token);
  const { allowed } = await hitRateLimit(
    rateLimitKeys.recoveryOtp(peek.id),
    RATE_LIMITS.recoveryOtp,
    db,
  );

  if (!allowed) {
    throw appError("TOO_MANY_REQUESTS", "otp_attempts_exceeded");
  }

  return db.transaction(async (tx) => {
    const { link } = await findLink(tx, input.token, true);
    const coversPassword = link.scope !== "twoFactor";
    const coversTwoFactor = link.scope !== "password";

    if (coversPassword) {
      if (!input.newPassword || input.newPassword.length < 6) {
        throw appError("BAD_REQUEST", "invalid_password");
      }
    } else {
      // a 2FA reset never skips the password
      await requirePassword(tx, link.userId, input.currentPassword ?? "");
    }

    let backupCodes: string[] | null = null;

    if (coversTwoFactor) {
      const secret = await confirmPendingEnrolment(
        tx,
        enrolKey(link.id),
        input.code ?? "",
      );

      if (!secret) {
        throw appError("BAD_REQUEST", "invalid_code");
      }

      backupCodes = await enrolTwoFactor(tx, link.userId, secret);
    }

    if (coversPassword && input.newPassword) {
      await setPassword(tx, link.userId, input.newPassword);
    }

    await tx
      .update(recoveryLinks)
      .set({ usedAt: now() })
      .where(eq(recoveryLinks.id, link.id));
    await revokeSessions(tx, link.userId);
    await audit(tx, {
      entityType: "user",
      entityId: link.userId,
      action: "update",
      userId: link.userId,
      payload: { recovered: link.scope },
    });

    // a password-only reset leaves 2FA in place: the user signs in normally
    const ticket = coversTwoFactor
      ? await issueSignInTicket(tx, link.userId)
      : null;

    return { backupCodes, ticket };
  });
};
