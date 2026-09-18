import { z } from "zod";

import {
  idSchema,
  minorUnitsSchema,
  trimmedName,
} from "~/lib/validators/common";

/** Account types a user can pick; "debt" accounts are system-managed */
export const USER_ACCOUNT_TYPES = [
  "cash",
  "card",
  "account",
  "credit",
  "deposit",
] as const;

export const accountInputSchema = z.object({
  name: trimmedName,
  currencyId: idSchema,
  type: z.enum(USER_ACCOUNT_TYPES).default("card"),
  initialBalance: minorUnitsSchema.default(0),
  isActive: z.boolean().default(true),
});

export const accountUpdateSchema = accountInputSchema.extend({ id: idSchema });

export type AccountInput = z.infer<typeof accountInputSchema>;
