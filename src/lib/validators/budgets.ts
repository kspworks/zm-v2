import { Schema } from "effect";

import { idSchema, magnitudeSchema } from "~/lib/validators/common";

export const budgetInputSchema = Schema.Struct({
  categoryId: idSchema,
  currencyId: idSchema,
  amount: magnitudeSchema,
});

export type BudgetInput = typeof budgetInputSchema.Type;
