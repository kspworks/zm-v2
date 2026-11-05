import { and, count, eq, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Locale } from "~/i18n/config";
import { totpQrDataUrl } from "~/server/auth/pending-enrolment";
import { issueSignInTicket } from "~/server/auth/sign-in-ticket";
import {
  enrolTwoFactor,
  hashPassword,
  totpMatches,
} from "~/server/auth/two-factor";
import {
  catchUniqueViolation,
  type Database,
  query,
  type SqlError,
  transaction,
} from "~/server/db/database";
import { authAccounts, invites, users } from "~/server/db/schema";
import {
  badRequest,
  type Forbidden,
  forbidden,
  tooManyRequests,
} from "~/server/lib/errors";
import {
  hitRateLimit,
  RATE_LIMITS,
  rateLimitKeys,
} from "~/server/lib/rate-limit";
import { generateTotpSecret, totpManualKey } from "~/server/lib/totp";
import { seedUserData } from "~/server/services/seed";

export const ADMIN_INVITE_ID = "admin";
export const SYSTEM_USER = "SYSTEM";

/** Active admins: not soft-deleted and not banned */
export const countActiveAdmins = Effect.fn("invites.countActiveAdmins")(
  function* () {
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
  },
);

type ValidInvite = { id: string; isAdmin: boolean; otpSecret: string | null };

/**
 * An invite is valid while unclaimed. The literal "admin" invite is valid only
 * while there are no active admins; its row is created on demand by
 * makeOtpQr. Every failure is the same FORBIDDEN answer.
 */
export const validateInvite = Effect.fn("invites.validate")(function* (
  id: string,
): Effect.fn.Return<ValidInvite, Forbidden | SqlError, Database> {
  const row = yield* query((db) =>
    db.query.invites.findFirst({ where: eq(invites.id, id) }),
  );

  if (id === ADMIN_INVITE_ID) {
    if ((yield* countActiveAdmins()) > 0) {
      return yield* forbidden("invite_invalid");
    }

    // a claimed admin invite re-opens once the last admin is gone
    return {
      id,
      isAdmin: true,
      otpSecret: row && row.userId === null ? row.otpSecret : null,
    };
  }

  if (!row || row.userId !== null || !row.otpSecret) {
    return yield* forbidden("invite_invalid");
  }

  return { id, isAdmin: false, otpSecret: row.otpSecret };
});

export const assertEmailAvailable = Effect.fn("invites.assertEmailAvailable")(
  function* (email: string) {
    const existing = yield* query((db) =>
      db.query.users.findFirst({
        columns: { id: true },
        where: and(
          sql`lower(${users.email}) = ${email.trim().toLowerCase()}`,
          isNull(users.deletedAt),
        ),
      }),
    );

    if (existing) {
      return yield* badRequest("email_not_unique");
    }
  },
);

/** Returns the invite's TOTP secret, creating the admin invite on demand */
const ensureInviteSecret = Effect.fnUntraced(function* (invite: ValidInvite) {
  if (!invite.isAdmin) {
    // non-admin invites always carry a secret (checked by validateInvite)
    return invite.otpSecret ?? "";
  }

  // keeps the secret of an unclaimed row, so the QR code stays stable; a
  // claimed row (bootstrap re-opened) gets a fresh secret
  const [row] = yield* query((db) =>
    db
      .insert(invites)
      .values({
        id: ADMIN_INVITE_ID,
        otpSecret: generateTotpSecret(),
        comment: "Admin bootstrap",
        createdBy: SYSTEM_USER,
      })
      .onConflictDoUpdate({
        target: invites.id,
        set: {
          otpSecret: sql`CASE WHEN ${invites.userId} IS NULL AND ${invites.otpSecret} IS NOT NULL THEN ${invites.otpSecret} ELSE excluded.otp_secret END`,
          userId: null,
          updatedAt: sql`now()`,
        },
      })
      .returning({ otpSecret: invites.otpSecret }),
  );

  return row?.otpSecret ?? "";
});

export const makeOtpQr = Effect.fn("invites.makeOtpQr")(function* (input: {
  id: string;
  email: string;
}) {
  const invite = yield* validateInvite(input.id);
  yield* assertEmailAvailable(input.email);

  const secret = yield* ensureInviteSecret(invite);

  return {
    qrDataUrl: yield* totpQrDataUrl(secret, input.email),
    manualKey: totpManualKey(secret),
  };
});

type Registration = {
  id: string;
  name: string;
  email: string;
  password: string;
  code: string;
  locale: Locale;
};

/** Creates the user, claims the invite and seeds their data, atomically */
const createRegisteredUser = Effect.fn("invites.createRegisteredUser")(
  function* (
    input: Registration,
    invite: ValidInvite,
    secret: string,
    passwordHash: string,
  ) {
    // the claim below is guarded on user_id and otp_secret, so a concurrent
    // second claim (or a second admin bootstrap) finds nothing to update
    // and rolls back this user insert with it
    const [user] = yield* query((db) =>
      db
        .insert(users)
        .values({
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          emailVerified: true,
          role: invite.isAdmin ? "admin" : "user",
          locale: input.locale,
        })
        .returning({ id: users.id }),
    );

    if (!user) {
      return yield* Effect.die(new Error("User insert returned no row"));
    }

    const claimed = yield* query((db) =>
      db
        .update(invites)
        .set({ userId: user.id, otpSecret: null })
        .where(
          and(
            eq(invites.id, invite.id),
            isNull(invites.userId),
            eq(invites.otpSecret, secret),
          ),
        )
        .returning({ id: invites.id }),
    );

    if (claimed.length === 0) {
      return yield* forbidden("invite_invalid");
    }

    if (invite.isAdmin && (yield* countActiveAdmins()) > 1) {
      return yield* forbidden("invite_invalid");
    }

    yield* query((db) =>
      db.insert(authAccounts).values({
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
      }),
    );

    const backupCodes = yield* enrolTwoFactor(user.id, secret);

    yield* seedUserData(user.id, input.locale);

    const ticket = yield* issueSignInTicket(user.id);

    return { backupCodes, ticket };
  },
  transaction,
  catchUniqueViolation("users_email_live_uq", () =>
    badRequest("email_not_unique"),
  ),
);

/**
 * Registers through an invite. The OTP attempt is counted first, outside the
 * transaction, so a failed registration still uses up an attempt.
 */
export const register = Effect.fn("invites.register")(function* (
  input: Registration,
) {
  const { allowed } = yield* hitRateLimit(
    rateLimitKeys.inviteOtp(input.id),
    RATE_LIMITS.inviteOtp,
  );

  if (!allowed) {
    return yield* tooManyRequests("otp_attempts_exceeded");
  }

  const invite = yield* validateInvite(input.id);
  yield* assertEmailAvailable(input.email);

  const secret = invite.otpSecret;

  if (!secret || !(yield* totpMatches(secret, input.code))) {
    return yield* badRequest("invalid_otp");
  }

  const passwordHash = yield* hashPassword(input.password);

  return yield* createRegisteredUser(input, invite, secret, passwordHash);
});
