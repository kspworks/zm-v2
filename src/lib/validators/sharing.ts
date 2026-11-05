import { Schema } from "effect";

import { emailSchema } from "~/lib/validators/auth";
import { idSchema, withDefault } from "~/lib/validators/common";

export const shareEntitySchema = Schema.Literals(["account", "category"]);

export type ShareEntity = typeof shareEntitySchema.Type;

const targetFields = { entity: shareEntitySchema, id: idSchema };

export const shareTargetSchema = Schema.Struct(targetFields);

export const shareAddSchema = Schema.Struct({
  ...targetFields,
  email: emailSchema,
  canWrite: Schema.Boolean.pipe(withDefault(false)),
});

export const shareRevokeSchema = Schema.Struct({
  ...targetFields,
  userId: idSchema,
});
