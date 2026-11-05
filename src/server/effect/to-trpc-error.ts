import { TRPCError } from "@trpc/server";
import { Cause } from "effect";

import { SqlError } from "~/server/db/database";
import type { AppError } from "~/server/lib/errors";

const CODES = {
  BadRequest: "BAD_REQUEST",
  Forbidden: "FORBIDDEN",
  NotFound: "NOT_FOUND",
  Unauthorized: "UNAUTHORIZED",
  TooManyRequests: "TOO_MANY_REQUESTS",
  ImportRowsError: "BAD_REQUEST",
} as const satisfies Record<AppError["_tag"], TRPCError["code"]>;

const fromAppError = (error: AppError): TRPCError => {
  const code = CODES[error._tag];

  switch (error._tag) {
    case "Unauthorized":
      return new TRPCError({ code });
    case "ImportRowsError":
      // the error formatter forwards `cause.rows` as data.importErrors
      return new TRPCError({ code, message: "import_invalid", cause: error });
    default:
      return new TRPCError({ code, message: error.key, cause: error });
  }
};

/**
 * The only place an Effect failure becomes a TRPCError: business errors keep
 * their code and message key, an interruption is the client going away, and
 * SqlErrors and defects are 500s carrying the original cause for Sentry.
 */
export const toTRPCError = (cause: Cause.Cause<AppError | SqlError>) => {
  const failure = Cause.findErrorOption(cause);

  if (failure._tag === "Some") {
    const error = failure.value;

    return error instanceof SqlError
      ? new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: error.cause })
      : fromAppError(error);
  }

  if (Cause.hasInterruptsOnly(cause)) {
    return new TRPCError({ code: "CLIENT_CLOSED_REQUEST" });
  }

  const defect = Cause.squash(cause);

  // code not yet migrated to Effect still throws TRPCErrors of its own
  if (defect instanceof TRPCError) {
    return defect;
  }

  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: defect });
};
