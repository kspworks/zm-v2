import { Schema } from "effect";

import {
  idSchema,
  message,
  nullable,
  trimmedName,
  withDefault,
} from "~/lib/validators/common";

const categoryFields = {
  name: trimmedName,
  parentId: nullable(idSchema),
  isExpense: Schema.Boolean.pipe(withDefault(true)),
  isIncome: Schema.Boolean.pipe(withDefault(false)),
};

const kindRequired = Schema.makeFilter(
  (value: { isExpense: boolean; isIncome: boolean }) =>
    value.isExpense || value.isIncome
      ? undefined
      : { path: ["isExpense"], issue: "category_kind_required" },
  message("category_kind_required"),
);

export const categoryInputSchema =
  Schema.Struct(categoryFields).check(kindRequired);

export const categoryUpdateSchema = Schema.Struct({
  ...categoryFields,
  id: idSchema,
}).check(kindRequired);

export type CategoryInput = typeof categoryInputSchema.Type;
