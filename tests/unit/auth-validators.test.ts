import { describe, expect, it } from "vitest";

import { otpSchema, secondFactorSchema } from "~/lib/validators/auth";

describe("otpSchema", () => {
  it.each([
    ["123456", "123456"],
    [" 123456 ", "123456"],
  ])("accepts %j as %j", (input, expected) => {
    expect(otpSchema.safeParse(input)).toMatchObject({
      success: true,
      data: expected,
    });
  });

  it.each([
    [""],
    ["12345"],
    ["1234567"],
    ["12a456"],
    ["12 3456"],
    ["aB3dE-fG5hJ"],
  ])("rejects %j", (input) => {
    expect(otpSchema.safeParse(input).success).toBe(false);
  });
});

describe("secondFactorSchema", () => {
  it.each([
    ["123456", "123456"],
    ["aB3dE-fG5hJ", "aB3dE-fG5hJ"],
    ["  aB3dE-fG5hJ  ", "aB3dE-fG5hJ"],
  ])("accepts %j as %j", (input, expected) => {
    expect(secondFactorSchema.safeParse(input)).toMatchObject({
      success: true,
      data: expected,
    });
  });

  it.each([["12345"], ["      "], ["a".repeat(33)]])("rejects %j", (input) => {
    expect(secondFactorSchema.safeParse(input).success).toBe(false);
  });
});
