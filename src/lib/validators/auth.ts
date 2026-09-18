import { z } from "zod";

export const nameSchema = z.string().trim().min(3).max(255);
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
export const passwordSchema = z.string().min(6).max(128);
export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);
/** A TOTP code, or a backup code such as "aB3dE-fG5hJ" */
export const secondFactorSchema = z.string().trim().min(6).max(32);

export const inviteIdSchema = z.string().trim().min(1).max(64);

export const registrationDetailsSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const makeOtpQrSchema = registrationDetailsSchema.extend({
  id: inviteIdSchema,
});

export const registerSchema = makeOtpQrSchema.extend({ code: otpSchema });
