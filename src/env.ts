import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const optionalString = z.string().optional();

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.url(),
    // full path of a Postgres Unix socket, e.g.
    // "/var/run/postgresql/.s.PGSQL.5432"; see "~/server/db/connection"
    DATABASE_SOCKET_PATH: z.string().startsWith("/").optional(),
    // compared to the literal "true": z.coerce.boolean() would read "false" as true
    DATABASE_LOG: z
      .string()
      .optional()
      .transform((value) => value === "true"),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url().optional(),
    VERCEL_URL: optionalString,
    CRON_SECRET: z.string().min(16),
    TRANSACTIONS_PAGINATION_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(50),
    APP_TIMEZONE: z.string().default("Europe/Kyiv"),
    MAIL_HOST: optionalString,
    MAIL_PORT: z.coerce.number().int().positive().optional(),
    MAIL_USERNAME: optionalString,
    MAIL_PASSWORD: optionalString,
    MAIL_FROM: optionalString,
    SENTRY_ORG: optionalString,
    SENTRY_PROJECT: optionalString,
  },
  client: {
    NEXT_PUBLIC_SENTRY_DSN: optionalString,
    NEXT_PUBLIC_SENTRY_ENV: optionalString,
    NEXT_PUBLIC_BUILD_ID: optionalString,
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SOCKET_PATH: process.env.DATABASE_SOCKET_PATH,
    DATABASE_LOG: process.env.DATABASE_LOG,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    TRANSACTIONS_PAGINATION_LIMIT: process.env.TRANSACTIONS_PAGINATION_LIMIT,
    APP_TIMEZONE: process.env.APP_TIMEZONE,
    MAIL_HOST: process.env.MAIL_HOST,
    MAIL_PORT: process.env.MAIL_PORT,
    MAIL_USERNAME: process.env.MAIL_USERNAME,
    MAIL_PASSWORD: process.env.MAIL_PASSWORD,
    MAIL_FROM: process.env.MAIL_FROM,
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_ENV: process.env.NEXT_PUBLIC_SENTRY_ENV,
    NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
