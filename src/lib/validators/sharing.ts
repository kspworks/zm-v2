import { z } from "zod";

import { emailSchema } from "~/lib/validators/auth";
import { idSchema } from "~/lib/validators/common";

export const shareEntitySchema = z.enum(["account", "category"]);

export type ShareEntity = z.infer<typeof shareEntitySchema>;

export const shareTargetSchema = z.object({
  entity: shareEntitySchema,
  id: idSchema,
});

export const shareAddSchema = shareTargetSchema.extend({
  email: emailSchema,
  canWrite: z.boolean().default(false),
});

export const shareRevokeSchema = shareTargetSchema.extend({
  userId: idSchema,
});
