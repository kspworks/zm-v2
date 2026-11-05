import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Effect } from "effect";

import {
  confirmPendingEnrolment,
  startPendingEnrolment,
} from "~/server/auth/pending-enrolment";
import { issueSignInTicket } from "~/server/auth/sign-in-ticket";
import { enrolTwoFactor } from "~/server/auth/two-factor";
import { query, transaction } from "~/server/db/database";
import { recoveryLinks, users } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";
import { now } from "~/server/lib/clock";
import {
  badRequest,
  forbidden,
  notFound,
  tooManyRequests,
} from "~/server/lib/errors";
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
export const createRecoveryLink = Effect.fn("recovery.createLink")(function* (
  adminId: string,
  input: { userId: string; scope: RecoveryScope; origin: string },
) {
  const [user] = yield* query((db) =>
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt))),
  );

  if (!user) {
    return yield* notFound();
  }

  const at = yield* now;

  yield* query((db) =>
    db
      .update(recoveryLinks)
      .set({ revokedAt: at })
      .where(
        and(
          eq(recoveryLinks.userId, user.id),
          isNull(recoveryLinks.usedAt),
          isNull(recoveryLinks.revokedAt),
        ),
      ),
  );

  const token = randomString(48);
  const [link] = yield* query((db) =>
    db
      .insert(recoveryLinks)
      .values({
        userId: user.id,
        tokenHash: sha256(token),
        scope: input.scope,
        createdBy: adminId,
        expiresAt: new Date(at.getTime() + TTL_MS),
        createdAt: at,
      })
      .returning({
        id: recoveryLinks.id,
        expiresAt: recoveryLinks.expiresAt,
      }),
  );

  yield* audit({
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
}, transaction);

/** Unused, unrevoked, unexpired links of a user */
export const listRecoveryLinks = Effect.fn("recovery.listLinks")(function* (
  userId: string,
) {
  const at = yield* now;

  return yield* query((db) =>
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
          gt(recoveryLinks.expiresAt, at),
        ),
      )
      .orderBy(desc(recoveryLinks.createdAt)),
  );
});

export const revokeRecoveryLink = Effect.fn("recovery.revokeLink")(function* (
  id: string,
) {
  const at = yield* now;

  yield* query((db) =>
    db
      .update(recoveryLinks)
      .set({ revokedAt: at })
      .where(and(eq(recoveryLinks.id, id), isNull(recoveryLinks.usedAt))),
  );
});

/** A usable link for a raw token; `lock` (inside a transaction) locks it */
const findLink = Effect.fnUntraced(function* (token: string, lock = false) {
  const at = yield* now;
  const [row] = yield* query((db) => {
    const select = db
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
          gt(recoveryLinks.expiresAt, at),
          isNull(users.deletedAt),
        ),
      );

    return lock ? select.for("update", { of: recoveryLinks }) : select;
  });

  if (!row) {
    return yield* forbidden("recovery_link_invalid");
  }

  return row;
});

export const validateRecoveryLink = Effect.fn("recovery.validateLink")(
  function* (token: string) {
    const { link, name, email } = yield* findLink(token);

    return { scope: link.scope, name, email };
  },
);

const enrolKey = (linkId: string) => `zm-recover-enrol:${linkId}`;

/** Starts the fresh TOTP enrolment for a 2FA-scoped link */
export const startRecoveryEnrolment = Effect.fn("recovery.startEnrolment")(
  function* (token: string) {
    const { link, email } = yield* findLink(token, true);

    if (link.scope === "password") {
      return yield* forbidden("recovery_link_invalid");
    }

    return yield* startPendingEnrolment(enrolKey(link.id), email);
  },
  transaction,
);

type CompletionInput = {
  token: string;
  newPassword?: string | null;
  currentPassword?: string | null;
  code?: string | null;
};

const applyRecovery = Effect.fn("recovery.apply")(function* (
  input: CompletionInput,
) {
  const { link } = yield* findLink(input.token, true);
  const coversPassword = link.scope !== "twoFactor";
  const coversTwoFactor = link.scope !== "password";

  if (coversPassword) {
    if (!input.newPassword || input.newPassword.length < 6) {
      return yield* badRequest("invalid_password");
    }
  } else {
    // a 2FA reset never skips the password
    yield* requirePassword(link.userId, input.currentPassword ?? "");
  }

  let backupCodes: string[] | null = null;

  if (coversTwoFactor) {
    const secret = yield* confirmPendingEnrolment(
      enrolKey(link.id),
      input.code ?? "",
    );

    if (!secret) {
      return yield* badRequest("invalid_code");
    }

    backupCodes = yield* enrolTwoFactor(link.userId, secret);
  }

  if (coversPassword && input.newPassword) {
    yield* setPassword(link.userId, input.newPassword);
  }

  const at = yield* now;

  yield* query((db) =>
    db
      .update(recoveryLinks)
      .set({ usedAt: at })
      .where(eq(recoveryLinks.id, link.id)),
  );
  yield* revokeSessions(link.userId);
  yield* audit({
    entityType: "user",
    entityId: link.userId,
    action: "update",
    userId: link.userId,
    payload: { recovered: link.scope },
  });

  // a password-only reset leaves 2FA in place: the user signs in normally
  const ticket = coversTwoFactor ? yield* issueSignInTicket(link.userId) : null;

  return { backupCodes, ticket };
}, transaction);

/**
 * Completes a recovery link: a new password and/or a new authenticator,
 * as the scope says. A 2FA-only link still needs the current password.
 * The link is single use; every session of the user is revoked. When the
 * user proved both factors, a sign-in ticket is returned. Attempts are
 * counted per link outside the transaction, so a failure still counts.
 */
export const completeRecovery = Effect.fn("recovery.complete")(function* (
  input: CompletionInput,
) {
  const { link: peek } = yield* findLink(input.token);
  const { allowed } = yield* hitRateLimit(
    rateLimitKeys.recoveryOtp(peek.id),
    RATE_LIMITS.recoveryOtp,
  );

  if (!allowed) {
    return yield* tooManyRequests("otp_attempts_exceeded");
  }

  return yield* applyRecovery(input);
});
