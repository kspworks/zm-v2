import { z } from "zod";

import { idSchema } from "~/lib/validators/common";
import {
  plannedCreateSchema,
  scheduleUpdateSchema,
} from "~/lib/validators/planned";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  createPlanned,
  deleteAllPlanned,
  getSchedule,
  updateSchedule,
} from "~/server/services/planned";

export const plannedRouter = createTRPCRouter({
  create: protectedProcedure
    .input(plannedCreateSchema)
    .mutation(({ ctx, input }) => createPlanned(ctx.db, ctx.user.id, input)),

  schedule: protectedProcedure
    .input(z.object({ id: idSchema }))
    .query(({ ctx, input }) => getSchedule(ctx.db, ctx.user.id, input.id)),

  updateSchedule: protectedProcedure
    .input(scheduleUpdateSchema)
    .mutation(({ ctx, input }) => updateSchedule(ctx.db, ctx.user.id, input)),

  /** From an occurrence: this one, the schedule and all its planned rows */
  deleteAll: protectedProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) =>
      deleteAllPlanned(ctx.db, ctx.user.id, input.id),
    ),
});
