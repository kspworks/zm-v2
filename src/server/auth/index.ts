import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { symmetricDecrypt } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { admin, twoFactor } from "better-auth/plugins";
import type { BetterAuthPlugin } from "better-auth/types";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { env } from "~/env";
import { ticketIdentifier } from "~/server/auth/sign-in-ticket";
import { authBaseUrl, isDev } from "~/server/config";
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
import { DEV_OTP, generateTotp } from "~/server/lib/totp";

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
          // development only: "111111" stands in for the current TOTP code
          matcher: (ctx) =>
            isDev() &&
            ctx.path === "/two-factor/verify-totp" &&
            ctx.body?.code === DEV_OTP,
          handler: createAuthMiddleware(async (ctx) => {
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

            return {
              context: { body: { ...ctx.body, code: generateTotp(secret) } },
            };
          }),
        },
      ],
      after: [
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
    // invite-only: users are created by the invites.register procedure
    disableSignUp: true,
    minPasswordLength: 6,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
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
