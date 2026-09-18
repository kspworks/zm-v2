import { z } from "zod";

import { idSchema, trimmedName } from "~/lib/validators/common";

export const categoryInputSchema = z
  .object({
    name: trimmedName,
    parentId: idSchema.nullish().transform((value) => value ?? null),
    isExpense: z.boolean().default(true),
    isIncome: z.boolean().default(false),
  })
  .refine((value) => value.isExpense || value.isIncome, {
    error: "category_kind_required",
    path: ["isExpense"],
  });

export const categoryUpdateSchema = z.intersection(
  categoryInputSchema,
  z.object({ id: idSchema }),
);

export type CategoryInput = z.infer<typeof categoryInputSchema>;
