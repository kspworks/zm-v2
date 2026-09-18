import { initTRPC, TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import superjson from "superjson";
import { ZodError, z } from "zod";

import { type Locale, resolveLocale } from "~/i18n/config";
import { auth } from "~/server/auth";
import { isDev } from "~/server/config";
import { type Db, db } from "~/server/db";
import { users } from "~/server/db/schema";
import { ImportRowsError } from "~/server/services/imports";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  locale: Locale;
};

export type Context = {
  db: Db;
  /** The session's user id; the user row itself is re-read per procedure */
  userId: string | null;
  /** The current session, kept when "other sessions" are revoked */
  sessionId?: string | null;
  /** The UI locale of this request (cookie or Accept-Language) */
  locale: Locale;
  /** The public origin, for links shown to the user */
  origin: string;
};

const readCookie = (header: string | null, name: string) =>
  header
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];

export const createTRPCContext = async ({
  headers,
}: {
  headers: Headers;
}): Promise<Context> => {
  const session = await auth.api.getSession({ headers });
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto") ?? "http";

  return {
    db,
    userId: session?.user.id ?? null,
    sessionId: session?.session.id ?? null,
    locale: resolveLocale({
      cookie: readCookie(headers.get("cookie"), "NEXT_LOCALE"),
      acceptLanguage: headers.get("accept-language"),
    }),
    origin: host ? `${proto}://${host}` : "",
  };
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? z.flattenError(error.cause) : null,
        importErrors:
          error.cause instanceof ImportRowsError ? error.cause.rows : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;

/** Development only: a random 100-500 ms delay and a timing log line */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (isDev()) {
    const delay = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const result = await next();

  if (isDev()) {
    // biome-ignore lint/suspicious/noConsole: development timing log
    console.log(`[TRPC] [${Date.now() - start}ms] ${path}`);
  }

  return result;
});

export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Resolves the *current* user from the database on every call, so deleting,
 * banning or re-roling a user takes effect on their next request.
 */
export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const row = await ctx.db.query.users.findFirst({
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      locale: true,
      banned: true,
      banExpires: true,
    },
    where: and(eq(users.id, ctx.userId), isNull(users.deletedAt)),
  });

  const banActive =
    row?.banned && (!row.banExpires || row.banExpires.getTime() > Date.now());

  if (!row || banActive) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const user: CurrentUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    locale: row.locale === "en" ? "en" : "uk",
  };

  return next({ ctx: { ...ctx, userId: user.id, user } });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }

  return next();
});
