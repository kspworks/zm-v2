import { z } from "zod";

import { MAX_INTEGER_DIGITS } from "~/lib/money";

export const idSchema = z.string().trim().min(1).max(64);

const MAX_MINOR = 10 ** (MAX_INTEGER_DIGITS + 2) - 1;

/** A signed amount in minor units within the 9-integer-digit input range */
export const minorUnitsSchema = z.number().int().min(-MAX_MINOR).max(MAX_MINOR);

export const calendarDateSchema = z.iso.date();

export const trimmedName = z.string().trim().min(1).max(255);

/** Trimmed, at most 500 chars; empty becomes null */
export const commentSchema = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((value) => (value ? value : null));
