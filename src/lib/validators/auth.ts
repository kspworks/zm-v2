import { Schema, SchemaTransformation } from "effect";

import { message, trimmedString } from "~/lib/validators/common";

// the pattern zod used for z.email(), so existing addresses keep validating
const EMAIL =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/** The address check alone, without trimming or lowercasing */
export const isEmail = Schema.isPattern(EMAIL, message("invalid_email"));

export const nameSchema = Schema.Trim.check(
  Schema.isMinLength(3, message("name_too_short")),
  Schema.isMaxLength(255, message("too_long")),
);

/** Trimmed and lowercased, then checked as an address */
export const emailSchema = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String.check(isEmail),
    SchemaTransformation.transform({
      decode: (value: string) => value.trim().toLowerCase(),
      encode: (value: string) => value,
    }),
  ),
);

export const passwordSchema = Schema.String.check(
  Schema.isMinLength(6, message("password_too_short")),
  Schema.isMaxLength(128, message("too_long")),
);

export const otpSchema = Schema.Trim.check(
  Schema.isPattern(/^\d{6}$/, message("invalid_otp")),
);

/** A TOTP code, or a backup code such as "aB3dE-fG5hJ" */
export const secondFactorSchema = Schema.Trim.check(
  Schema.isMinLength(6, message("invalid_code")),
  Schema.isMaxLength(32, message("invalid_code")),
);

export const inviteIdSchema = trimmedString(64);

const registrationFields = {
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
};

export const registrationDetailsSchema = Schema.Struct(registrationFields);

export const makeOtpQrSchema = Schema.Struct({
  ...registrationFields,
  id: inviteIdSchema,
});

export const registerSchema = Schema.Struct({
  ...registrationFields,
  id: inviteIdSchema,
  code: otpSchema,
});
