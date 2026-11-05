import { createEnv } from "@t3-oss/env-nextjs";
import { Schema, SchemaTransformation } from "effect";

/*
 * Each variable is an Effect Schema handed to t3-env as a Standard Schema.
 * Variables arrive as strings or undefined (empty strings become undefined).
 */

const env$ = <S extends Schema.Decoder<unknown>>(schema: S) =>
  Schema.toStandardSchemaV1(schema);

const optionalString = env$(Schema.UndefinedOr(Schema.String));

/** Undefined decodes to `fallback` */
const orDefault = <T>(schema: Schema.Codec<T, string>, fallback: T) =>
  Schema.UndefinedOr(schema).pipe(
    Schema.decodeTo(
      Schema.toType(schema),
      SchemaTransformation.transform<T, T | undefined>({
        decode: (value) => value ?? fallback,
        encode: (value: T) => value,
      }),
    ),
  );

const url = Schema.String.check(
  Schema.makeFilter((value: string) => URL.canParse(value)),
);

const redisUrl = url.check(
  Schema.makeFilter((value: string) =>
    ["redis:", "rediss:"].includes(new URL(value).protocol),
  ),
);

const positiveInt = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
);

export const env = createEnv({
  server: {
    NODE_ENV: env$(
      orDefault(
        Schema.Literals(["development", "test", "production"]),
        "development",
      ),
    ),
    DATABASE_URL: env$(url),
    // full path of a Postgres Unix socket, e.g.
    // "/var/run/postgresql/.s.PGSQL.5432"; see "~/server/db/connection"
    DATABASE_SOCKET_PATH: env$(
      Schema.UndefinedOr(Schema.String.check(Schema.isStartingWith("/"))),
    ),
    // compared to the literal "true": a boolean coercion would read "false"
    // as true
    DATABASE_LOG: env$(
      Schema.UndefinedOr(Schema.String).pipe(
        Schema.decodeTo(
          Schema.Boolean,
          SchemaTransformation.transform<boolean, string | undefined>({
            decode: (value) => value === "true",
            encode: (value: boolean) => String(value),
          }),
        ),
      ),
    ),
    // optional: rate limits use Redis when set, Postgres otherwise (and as
    // the per-call fallback when Redis is unreachable); see
    // "~/server/lib/rate-limit"
    REDIS_URL: env$(Schema.UndefinedOr(redisUrl)),
    BETTER_AUTH_SECRET: env$(Schema.String.check(Schema.isMinLength(32))),
    BETTER_AUTH_URL: env$(Schema.UndefinedOr(url)),
    VERCEL_URL: optionalString,
    CRON_SECRET: env$(Schema.String.check(Schema.isMinLength(16))),
    TRANSACTIONS_PAGINATION_LIMIT: env$(orDefault(positiveInt, 50)),
    APP_TIMEZONE: env$(orDefault(Schema.String, "Europe/Kyiv")),
    MAIL_HOST: optionalString,
    MAIL_PORT: env$(Schema.UndefinedOr(positiveInt)),
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
    REDIS_URL: process.env.REDIS_URL,
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
