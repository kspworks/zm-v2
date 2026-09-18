import "server-only";

import { env } from "~/env";

/**
 * Read-site accessors for env values. With SKIP_ENV_VALIDATION the schema never
 * runs, so numbers arrive as strings and empty strings are not stripped: every
 * value is coerced again here instead of trusting the parsed type.
 */

const str = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const text = String(value).trim();

  return text === "" ? undefined : text;
};

const int = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(str(value) ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const paginationLimit = (): number =>
  int(env.TRANSACTIONS_PAGINATION_LIMIT, 50);

export const appTimezone = (): string =>
  str(process.env.APP_TIMEZONE) ?? str(env.APP_TIMEZONE) ?? "Europe/Kyiv";

export const cronSecret = (): string | undefined => {
  const secret = str(env.CRON_SECRET);

  return secret && secret.length >= 16 ? secret : undefined;
};

export const authBaseUrl = (): string => {
  const explicit = str(env.BETTER_AUTH_URL);

  if (explicit) {
    return explicit;
  }

  const vercel = str(env.VERCEL_URL);

  return vercel ? `https://${vercel}` : "http://localhost:3000";
};

export type MailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

export const mailConfig = (): MailConfig | null => {
  const host = str(env.MAIL_HOST);
  const user = str(env.MAIL_USERNAME);
  const pass = str(env.MAIL_PASSWORD);

  if (!host || !user || !pass) {
    return null;
  }

  return {
    host,
    port: int(env.MAIL_PORT, 465),
    user,
    pass,
    from: str(env.MAIL_FROM) ?? user,
  };
};

export const isDev = (): boolean => env.NODE_ENV === "development";

export const buildId = (): string | undefined => str(env.NEXT_PUBLIC_BUILD_ID);
