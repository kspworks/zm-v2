import { Schema } from "effect";

import {
  idSchema,
  minorUnitsSchema,
  trimmedName,
  withDefault,
} from "~/lib/validators/common";

/** Account types a user can pick; "debt" accounts are system-managed */
export const USER_ACCOUNT_TYPES = [
  "cash",
  "card",
  "account",
  "credit",
  "deposit",
] as const;

const accountFields = {
  name: trimmedName,
  currencyId: idSchema,
  type: Schema.Literals(USER_ACCOUNT_TYPES).pipe(withDefault("card")),
  initialBalance: minorUnitsSchema.pipe(withDefault(0)),
  isActive: Schema.Boolean.pipe(withDefault(true)),
};

export const accountInputSchema = Schema.Struct(accountFields);

export const accountUpdateSchema = Schema.Struct({
  ...accountFields,
  id: idSchema,
});

export type AccountInput = typeof accountInputSchema.Type;
