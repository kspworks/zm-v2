import { z } from "zod";

import { idSchema } from "~/lib/validators/common";
import {
  plannedCreateSchema,
  scheduleUpdateSchema,
} from "~/lib/validators/planned";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import {
  createPlanned,
  deleteAllPlanned,
  getSchedule,
  updateSchedule,
} from "~/server/services/planned";

export const plannedRouter = createTRPCRouter({
  create: protectedProcedure
    .input(plannedCreateSchema)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(createPlanned(ctx.user.id, input), signal),
    ),

  schedule: protectedProcedure
    .input(z.object({ id: idSchema }))
    .query(({ ctx, input, signal }) =>
      runForTrpc(getSchedule(ctx.user.id, input.id), signal),
    ),

  updateSchedule: protectedProcedure
    .input(scheduleUpdateSchema)
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(updateSchedule(ctx.user.id, input), signal),
    ),

  /** From an occurrence: this one, the schedule and all its planned rows */
  deleteAll: protectedProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteAllPlanned(ctx.user.id, input.id), signal),
    ),
});
