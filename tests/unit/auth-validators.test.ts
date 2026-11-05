import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { otpSchema, secondFactorSchema } from "~/lib/validators/auth";

/** The decoded value, or undefined when the input is rejected */
const decode =
  <S extends Schema.Decoder<string>>(schema: S) =>
  (input: unknown) => {
    const exit = Schema.decodeUnknownExit(schema)(input);

    return Exit.isSuccess(exit) ? exit.value : undefined;
  };

const otp = decode(otpSchema);
const secondFactor = decode(secondFactorSchema);

describe("otpSchema", () => {
  it.each([
    ["123456", "123456"],
    [" 123456 ", "123456"],
  ])("accepts %j as %j", (input, expected) => {
    expect(otp(input)).toBe(expected);
  });

  it.each([
    [""],
    ["12345"],
    ["1234567"],
    ["12a456"],
    ["12 3456"],
    ["aB3dE-fG5hJ"],
  ])("rejects %j", (input) => {
    expect(otp(input)).toBeUndefined();
  });
});

describe("secondFactorSchema", () => {
  it.each([
    ["123456", "123456"],
    ["aB3dE-fG5hJ", "aB3dE-fG5hJ"],
    ["  aB3dE-fG5hJ  ", "aB3dE-fG5hJ"],
  ])("accepts %j as %j", (input, expected) => {
    expect(secondFactor(input)).toBe(expected);
  });

  it.each([["12345"], ["      "], ["a".repeat(33)]])("rejects %j", (input) => {
    expect(secondFactor(input)).toBeUndefined();
  });
});
