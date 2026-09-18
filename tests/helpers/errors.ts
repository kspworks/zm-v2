import { TRPCError } from "@trpc/server";
import { expect } from "vitest";

/** Asserts on the stable app-level contract: the tRPC code and message key */
export const expectTRPCError = async (
  promise: Promise<unknown>,
  code: TRPCError["code"],
  message?: string,
) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error, "expected the call to throw").toBeInstanceOf(TRPCError);
  expect((error as TRPCError).code).toBe(code);

  if (message !== undefined) {
    expect((error as TRPCError).message).toBe(message);
  }

  return error as TRPCError;
};
