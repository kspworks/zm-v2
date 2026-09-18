import { TRPCError } from "@trpc/server";

import type { ErrorKey } from "~/lib/error-keys";

type Code =
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "TOO_MANY_REQUESTS";

/** A business-rule violation carrying a stable, translatable message key */
export const appError = (
  code: Code,
  key: ErrorKey,
  cause?: unknown,
): TRPCError => new TRPCError({ code, message: key, cause });

export const badRequest = (key: ErrorKey) => appError("BAD_REQUEST", key);
export const forbidden = (key: ErrorKey = "forbidden") =>
  appError("FORBIDDEN", key);
export const notFound = () => appError("NOT_FOUND", "not_found");

/** postgres-js surfaces the SQLSTATE and constraint name on the error */
export const isUniqueViolation = (error: unknown, constraint?: string) => {
  const cause = findPgError(error);

  return (
    cause?.code === "23505" &&
    (constraint === undefined || cause.constraint_name === constraint)
  );
};

const findPgError = (
  error: unknown,
): { code?: string; constraint_name?: string } | undefined => {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth++) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      typeof (current as { code: unknown }).code === "string" &&
      /^[0-9A-Z]{5}$/.test((current as { code: string }).code)
    ) {
      return current as { code?: string; constraint_name?: string };
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
};
