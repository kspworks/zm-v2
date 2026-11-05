import { initTRPC, StandardSchemaV1Error, TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Schema } from "effect";
import superjson from "superjson";

import { type Locale, resolveLocale } from "~/i18n/config";
import { auth } from "~/server/auth";
import { isDev } from "~/server/config";
import { query } from "~/server/db/database";
import { users } from "~/server/db/schema";
import { runForTrpc } from "~/server/effect/runtime";
import { now } from "~/server/lib/clock";
import { ImportRowsError, unauthorized } from "~/server/lib/errors";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  locale: Locale;
};

export type Context = {
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
    userId: session?.user.id ?? null,
    sessionId: session?.session.id ?? null,
    locale: resolveLocale({
      cookie: readCookie(headers.get("cookie"), "NEXT_LOCALE"),
      acceptLanguage: headers.get("accept-language"),
    }),
    origin: host ? `${proto}://${host}` : "",
  };
};

type Issue = StandardSchemaV1Error["issues"][number];

/**
 * Input validation issues as `{ formErrors, fieldErrors }`: messages without a
 * path, and messages per top-level field (the app's error keys)
 */
const flattenIssues = (issues: readonly Issue[]) => {
  const formErrors: string[] = [];
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of issues) {
    const [first] = issue.path ?? [];
    const key = typeof first === "object" ? first.key : first;

    if (key === undefined) {
      formErrors.push(issue.message);
    } else {
      fieldErrors[String(key)] = [
        ...(fieldErrors[String(key)] ?? []),
        issue.message,
      ];
    }
  }

  return { formErrors, fieldErrors };
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        validationError:
          error.cause instanceof StandardSchemaV1Error
            ? flattenIssues(error.cause.issues)
            : null,
        importErrors:
          error.cause instanceof ImportRowsError ? error.cause.rows : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;

/** A procedure input validated (and decoded) by an Effect Schema */
export const validate = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.toStandardSchemaV1(schema);
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
const loadCurrentUser = Effect.fn("trpc.loadCurrentUser")(function* (
  userId: string,
) {
  const row = yield* query((db) =>
    db.query.users.findFirst({
      columns: {
        id: true,
        name: true,
        email: true,
        role: true,
        locale: true,
        banned: true,
        banExpires: true,
      },
      where: and(eq(users.id, userId), isNull(users.deletedAt)),
    }),
  );
  const at = yield* now;
  const banActive =
    row?.banned && (!row.banExpires || row.banExpires.getTime() > at.getTime());

  if (!row || banActive) {
    return yield* unauthorized();
  }

  const user: CurrentUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    locale: row.locale === "en" ? "en" : "uk",
  };

  return user;
});

/**
 * Resolves the *current* user from the database on every call, so deleting,
 * banning or re-roling a user takes effect on their next request.
 */
export const protectedProcedure = publicProcedure.use(
  async ({ ctx, next, signal }) => {
    if (!ctx.userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const user = await runForTrpc(loadCurrentUser(ctx.userId), signal);

    return next({ ctx: { ...ctx, userId: user.id, user } });
  },
);

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }

  return next();
});
