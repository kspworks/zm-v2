import "server-only";

import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
  hashPassword as scryptHash,
  verifyPassword as scryptVerify,
  symmetricDecrypt,
} from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { admin, twoFactor } from "better-auth/plugins";
import type { BetterAuthPlugin } from "better-auth/types";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { env } from "~/env";
import { ticketIdentifier } from "~/server/auth/sign-in-ticket";
import { verifySecondFactor } from "~/server/auth/two-factor";
import { authBaseUrl, isDev, mailConfig } from "~/server/config";
import { db } from "~/server/db";
import * as schema from "~/server/db/schema";
import { newId } from "~/server/lib/ids";
import {
  hitRateLimit,
  RATE_LIMITS,
  rateLimitKeys,
  resetRateLimit,
} from "~/server/lib/rate-limit";
import { reportError } from "~/server/lib/report";
import {
  betterAuthTotp,
  DEV_OTP,
  LEGACY_PREFIX,
  verifyTotp,
} from "~/server/lib/totp";
import { passwordResetEmail } from "~/server/mail/templates";
import { sendMail } from "~/server/mail/transport";

export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;

const TWO_FACTOR_COOKIE = "two_factor";

/** Paths whose success means "signed in", which resets the login limiter */
const SIGN_IN_COMPLETE_PATHS = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

const zm = () =>
  ({
    id: "zm",
    endpoints: {
      ticketSignIn: createAuthEndpoint(
        "/zm/ticket-sign-in",
        {
          method: "POST",
          body: z.object({ ticket: z.string().min(1).max(128) }),
        },
        async (ctx) => {
          const consumed =
            await ctx.context.internalAdapter.consumeVerificationValue(
              ticketIdentifier(ctx.body.ticket),
            );

          if (!consumed) {
            throw new APIError("UNAUTHORIZED", { code: "INVALID_TICKET" });
          }

          const user = await ctx.context.internalAdapter.findUserById(
            consumed.value,
          );

          if (!user) {
            throw new APIError("UNAUTHORIZED", { code: "INVALID_TICKET" });
          }

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );

          await setSessionCookie(ctx, { session, user });

          return ctx.json({ ok: true });
        },
      ),
    },
    hooks: {
      before: [
        {
          // 10 attempts per 15 min, keyed by the lowercased email: an IP can
          // be spoofed through forwarding headers, the target account can't
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const email = String(ctx.body?.email ?? "");
            const { allowed } = await hitRateLimit(
              rateLimitKeys.login(email),
              RATE_LIMITS.login,
            );

            if (!allowed) {
              throw new APIError("TOO_MANY_REQUESTS", {
                code: "TOO_MANY_REQUESTS",
              });
            }
          }),
        },
        {
          // "forgot password": 3 requests per hour per email
          matcher: (ctx) => ctx.path === "/request-password-reset",
          handler: createAuthMiddleware(async (ctx) => {
            const email = String(ctx.body?.email ?? "");
            const { allowed } = await hitRateLimit(
              rateLimitKeys.resetRequest(email),
              RATE_LIMITS.resetRequest,
            );

            if (!allowed) {
              throw new APIError("TOO_MANY_REQUESTS", {
                code: "TOO_MANY_REQUESTS",
              });
            }
          }),
        },
        {
          // a password reset never removes 2FA: it also needs a TOTP or a
          // backup code, and submissions are limited per token
          matcher: (ctx) => ctx.path === "/reset-password",
          handler: createAuthMiddleware(async (ctx) => {
            const token = String(ctx.body?.token ?? ctx.query?.token ?? "");
            const code = String(ctx.body?.code ?? "");
            const { allowed } = await hitRateLimit(
              rateLimitKeys.resetSubmit(token),
              RATE_LIMITS.resetSubmit,
            );

            if (!allowed) {
              throw new APIError("TOO_MANY_REQUESTS", {
                code: "TOO_MANY_REQUESTS",
              });
            }

            const pending =
              await ctx.context.internalAdapter.findVerificationValue(
                `reset-password:${token}`,
              );

            if (!pending) {
              throw new APIError("BAD_REQUEST", { code: "INVALID_TOKEN" });
            }

            const ok = await db.transaction((tx) =>
              verifySecondFactor(tx, pending.value, code, {
                allowBackupCode: true,
              }),
            );

            if (!ok) {
              throw new APIError("BAD_REQUEST", { code: "INVALID_CODE" });
            }
          }),
        },
        {
          // translate the code the user typed into the one better-auth
          // computes from the stored secret: the dev "111111", and codes for
          // v1-migrated base32 secrets (stored as "b32:...")
          matcher: (ctx) => ctx.path === "/two-factor/verify-totp",
          handler: createAuthMiddleware(async (ctx) => {
            const code = String(ctx.body?.code ?? "");
            const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
            const identifier = await ctx.getSignedCookie(
              cookie.name,
              ctx.context.secret,
            );
            const pending = identifier
              ? await ctx.context.internalAdapter.findVerificationValue(
                  identifier,
                )
              : null;
            const row = pending
              ? await db.query.twoFactors.findFirst({
                  where: eq(schema.twoFactors.userId, pending.value),
                })
              : undefined;

            if (!row) {
              return;
            }

            const secret = await symmetricDecrypt({
              key: ctx.context.secretConfig,
              data: row.secret,
            });
            const legacy = secret.startsWith(LEGACY_PREFIX);

            if (
              (isDev() && code === DEV_OTP) ||
              (legacy && verifyTotp(secret, code))
            ) {
              return {
                context: {
                  body: { ...ctx.body, code: betterAuthTotp(secret) },
                },
              };
            }
          }),
        },
      ],
      after: [
        {
          // v1 passwords are bcrypt: after a correct one, store scrypt instead
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned as
              | { twoFactorRedirect?: boolean; token?: string }
              | undefined;
            const email = String(ctx.body?.email ?? "")
              .trim()
              .toLowerCase();
            const password = String(ctx.body?.password ?? "");

            if (!returned || !(returned.twoFactorRedirect || returned.token)) {
              return;
            }

            const [credential] = await db
              .select({
                id: schema.authAccounts.id,
                hash: schema.authAccounts.password,
              })
              .from(schema.authAccounts)
              .innerJoin(
                schema.users,
                eq(schema.users.id, schema.authAccounts.userId),
              )
              .where(
                and(
                  eq(schema.users.email, email),
                  eq(schema.authAccounts.providerId, "credential"),
                ),
              );

            if (credential?.hash?.startsWith("$2")) {
              await db
                .update(schema.authAccounts)
                .set({ password: await scryptHash(password) })
                .where(eq(schema.authAccounts.id, credential.id));
            }
          }),
        },
        {
          matcher: (ctx) => SIGN_IN_COMPLETE_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const email = ctx.context.newSession?.user.email;

            if (email) {
              await resetRateLimit(rateLimitKeys.login(email));
            }
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;

export const auth = betterAuth({
  appName: "ZM",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: authBaseUrl(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      users: schema.users,
      sessions: schema.sessions,
      authAccounts: schema.authAccounts,
      verifications: schema.verifications,
      twoFactors: schema.twoFactors,
      authRateLimits: schema.authRateLimits,
    },
  }),
  user: {
    modelName: "users",
    additionalFields: {
      locale: { type: "string", required: false, input: false },
      deletedAt: { type: "date", required: false, input: false },
    },
  },
  session: {
    modelName: "sessions",
    expiresIn: SESSION_TTL_SECONDS,
    updateAge: 24 * 60 * 60,
    // no cookie cache: every request re-reads the session row, so deleting,
    // banning or revoking takes effect on the next request
    cookieCache: { enabled: false },
  },
  account: { modelName: "authAccounts" },
  verification: { modelName: "verifications" },
  emailAndPassword: {
    enabled: true,
    // bcrypt hashes migrated from v1 verify too (and are rehashed on sign-in)
    password: {
      hash: scryptHash,
      verify: ({ hash, password }) =>
        hash.startsWith("$2")
          ? bcrypt.compare(password, hash)
          : scryptVerify({ hash, password }),
    },
    // invite-only: users are created by the invites.register procedure
    disableSignUp: true,
    minPasswordLength: 6,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    // without SMTP the "forgot password" link is hidden and this is a no-op;
    // the answer is the same either way, so addresses can't be enumerated
    sendResetPassword: async ({ user, url }) => {
      if (!mailConfig()) {
        return;
      }

      const locale =
        (user as { locale?: string }).locale === "en" ? "en" : "uk";
      const mail = await passwordResetEmail(locale, { name: user.name, url });
      await sendMail({ to: user.email, ...mail });
    },
  },
  rateLimit: {
    enabled: env.NODE_ENV !== "test",
    storage: "database",
    modelName: "authRateLimits",
  },
  advanced: {
    database: { generateId: () => newId() },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await db.query.users.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.users.id, session.userId),
              isNull(schema.users.deletedAt),
            ),
          });

          return user ? { data: session } : false;
        },
      },
    },
  },
  onAPIError: {
    onError: (error) => {
      // expected rejections (wrong password, rate limits) are APIErrors
      if (!(error instanceof APIError)) {
        reportError(error, "auth");
      }
    },
  },
  plugins: [
    twoFactor({
      issuer: "ZM",
      schema: { twoFactor: { modelName: "twoFactors" } },
      backupCodeOptions: { storeBackupCodes: "encrypted", amount: 10 },
    }),
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
    zm(),
    // must stay last: forwards Set-Cookie from server actions
    nextCookies(),
  ],
});

export type Auth = typeof auth;
