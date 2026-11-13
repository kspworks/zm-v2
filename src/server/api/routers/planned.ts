import { Schema } from "effect";

import { idSchema } from "~/lib/validators/common";
import {
  plannedCreateSchema,
  scheduleUpdateSchema,
} from "~/lib/validators/planned";
import {
  createTRPCRouter,
  protectedProcedure,
  validate,
} from "~/server/api/trpc";
import { runForTrpc } from "~/server/effect/runtime";
import { idempotent } from "~/server/lib/idempotency";
import {
  createPlanned,
  deleteAllPlanned,
  getSchedule,
  updateSchedule,
} from "~/server/services/planned";

export const plannedRouter = createTRPCRouter({
  create: protectedProcedure
    .input(validate(plannedCreateSchema))
    .mutation(({ ctx, input: { idempotencyKey, ...input }, signal }) =>
      runForTrpc(
        idempotent(
          {
            userId: ctx.user.id,
            procedure: "planned.create",
            key: idempotencyKey,
            request: input,
          },
          createPlanned(ctx.user.id, input),
        ),
        signal,
      ),
    ),

  schedule: protectedProcedure
    .input(validate(Schema.Struct({ id: idSchema })))
    .query(({ ctx, input, signal }) =>
      runForTrpc(getSchedule(ctx.user.id, input.id), signal),
    ),

  updateSchedule: protectedProcedure
    .input(validate(scheduleUpdateSchema))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(updateSchedule(ctx.user.id, input), signal),
    ),

  /** From an occurrence: this one, the schedule and all its planned rows */
  deleteAll: protectedProcedure
    .input(validate(Schema.Struct({ id: idSchema })))
    .mutation(({ ctx, input, signal }) =>
      runForTrpc(deleteAllPlanned(ctx.user.id, input.id), signal),
    ),
});
