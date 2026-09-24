import { and, count, eq, isNull, sql } from "drizzle-orm";
import QRCode from "qrcode";

import type { Locale } from "~/i18n/config";
import { issueSignInTicket } from "~/server/auth/sign-in-ticket";
import { enrolTwoFactor, hashPassword } from "~/server/auth/two-factor";
import { type DbOrTx, db as defaultDb } from "~/server/db";
import { authAccounts, invites, users } from "~/server/db/schema";
import { appError, forbidden, isUniqueViolation } from "~/server/lib/errors";
import {
  hitRateLimit,
  RATE_LIMITS,
  rateLimitKeys,
} from "~/server/lib/rate-limit";
import {
  generateTotpSecret,
  totpManualKey,
  totpUri,
  verifyTotp,
} from "~/server/lib/totp";
import { seedUserData } from "~/server/services/seed";

export const ADMIN_INVITE_ID = "admin";
export const SYSTEM_USER = "SYSTEM";

/** Active admins: not soft-deleted and not banned */
export const countActiveAdmins = async (
  db: DbOrTx = defaultDb,
): Promise<number> => {
  const [row] = await db
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

type ValidInvite = { id: string; isAdmin: boolean; otpSecret: string | null };

/**
 * An invite is valid while unclaimed. The literal "admin" invite is valid only
 * while there are no active admins; its row is created on demand by
 * makeOtpQr. Every failure is the same FORBIDDEN answer.
 */
export const validateInvite = async (
  id: string,
  db: DbOrTx = defaultDb,
): Promise<ValidInvite> => {
  const row = await db.query.invites.findFirst({ where: eq(invites.id, id) });

  if (id === ADMIN_INVITE_ID) {
    if ((await countActiveAdmins(db)) > 0) {
      throw forbidden("invite_invalid");
    }

    // a claimed admin invite re-opens once the last admin is gone
    return {
      id,
      isAdmin: true,
      otpSecret: row && row.userId === null ? row.otpSecret : null,
    };
  }

  if (!row || row.userId !== null || !row.otpSecret) {
    throw forbidden("invite_invalid");
  }

  return { id, isAdmin: false, otpSecret: row.otpSecret };
};

export const assertEmailAvailable = async (
  email: string,
  db: DbOrTx = defaultDb,
): Promise<void> => {
  const existing = await db.query.users.findFirst({
    columns: { id: true },
    where: and(
      sql`lower(${users.email}) = ${email.trim().toLowerCase()}`,
      isNull(users.deletedAt),
    ),
  });

  if (existing) {
    throw appError("BAD_REQUEST", "email_not_unique");
  }
};

/** Returns the invite's TOTP secret, creating the admin invite on demand */
const ensureInviteSecret = async (
  invite: ValidInvite,
  db: DbOrTx,
): Promise<string> => {
  if (!invite.isAdmin) {
    // non-admin invites always carry a secret (checked by validateInvite)
    return invite.otpSecret ?? "";
  }

  // keeps the secret of an unclaimed row, so the QR code stays stable; a
  // claimed row (bootstrap re-opened) gets a fresh secret
  const [row] = await db
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
    .returning({ otpSecret: invites.otpSecret });

  return row?.otpSecret ?? "";
};

export const makeOtpQr = async (
  input: { id: string; email: string },
  db: DbOrTx = defaultDb,
): Promise<{ qrDataUrl: string; manualKey: string }> => {
  const invite = await validateInvite(input.id, db);
  await assertEmailAvailable(input.email, db);

  const secret = await ensureInviteSecret(invite, db);
  const uri = totpUri(secret, input.email);

  return {
    qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 240 }),
    manualKey: totpManualKey(secret),
  };
};

export const register = async (
  input: {
    id: string;
    name: string;
    email: string;
    password: string;
    code: string;
    locale: Locale;
  },
  db: DbOrTx = defaultDb,
): Promise<{ backupCodes: string[]; ticket: string }> => {
  const { allowed } = await hitRateLimit(
    rateLimitKeys.inviteOtp(input.id),
    RATE_LIMITS.inviteOtp,
    db,
  );

  if (!allowed) {
    throw appError("TOO_MANY_REQUESTS", "otp_attempts_exceeded");
  }

  const invite = await validateInvite(input.id, db);
  await assertEmailAvailable(input.email, db);

  if (!invite.otpSecret || !verifyTotp(invite.otpSecret, input.code)) {
    throw appError("BAD_REQUEST", "invalid_otp");
  }

  const secret = invite.otpSecret;
  const passwordHash = await hashPassword(input.password);

  try {
    return await db.transaction(async (tx) => {
      // the claim below is guarded on user_id and otp_secret, so a concurrent
      // second claim (or a second admin bootstrap) finds nothing to update
      // and rolls back this user insert with it
      const [user] = await tx
        .insert(users)
        .values({
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          emailVerified: true,
          role: invite.isAdmin ? "admin" : "user",
          locale: input.locale,
        })
        .returning({ id: users.id });

      if (!user) {
        throw new Error("User insert returned no row");
      }

      const claimed = await tx
        .update(invites)
        .set({ userId: user.id, otpSecret: null })
        .where(
          and(
            eq(invites.id, invite.id),
            isNull(invites.userId),
            eq(invites.otpSecret, secret),
          ),
        )
        .returning({ id: invites.id });

      if (claimed.length === 0) {
        throw forbidden("invite_invalid");
      }

      if (invite.isAdmin && (await countActiveAdmins(tx)) > 1) {
        throw forbidden("invite_invalid");
      }

      await tx.insert(authAccounts).values({
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
      });

      const backupCodes = await enrolTwoFactor(tx, user.id, secret);

      await seedUserData(tx, user.id, input.locale);

      const ticket = await issueSignInTicket(tx, user.id);

      return { backupCodes, ticket };
    });
  } catch (error) {
    if (isUniqueViolation(error, "users_email_live_uq")) {
      throw appError("BAD_REQUEST", "email_not_unique", error);
    }

    throw error;
  }
};
