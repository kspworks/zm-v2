import { eq } from "drizzle-orm";
import { z } from "zod";

import { LOCALES } from "~/i18n/config";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { buildId, isDev } from "~/server/config";
import { users } from "~/server/db/schema";

export const meRouter = createTRPCRouter({
  get: protectedProcedure.query(({ ctx }) => ({
    ...ctx.user,
    // shown to admins in the user menu
    build:
      ctx.user.role === "admin"
        ? { id: buildId() ?? null, env: process.env.NODE_ENV }
        : null,
    isDev: isDev(),
  })),

  setLocale: protectedProcedure
    .input(z.object({ locale: z.enum(LOCALES) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(users)
        .set({ locale: input.locale })
        .where(eq(users.id, ctx.user.id));

      return { locale: input.locale };
    }),
});
