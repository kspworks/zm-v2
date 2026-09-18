import { z } from "zod";

import { REPEAT_TYPES } from "~/lib/schedule";
import { calendarDateSchema, idSchema } from "~/lib/validators/common";
import { transactionInputSchema } from "~/lib/validators/transactions";

export const REPEAT_OPTIONS = ["none", ...REPEAT_TYPES] as const;

export const scheduleFieldsSchema = z.object({
  repeatType: z.enum(REPEAT_OPTIONS),
  repeatInterval: z.number().int().min(1).max(31).default(1),
  repeatWeekdays: z.array(z.number().int()).max(7).default([]),
  endDate: calendarDateSchema.nullish().transform((value) => value ?? null),
});

export type ScheduleFields = z.infer<typeof scheduleFieldsSchema>;

/** Weekdays and the end date checked against the start (the form's date) */
const checkSchedule = (
  schedule: ScheduleFields,
  startDate: string,
  ctx: z.RefinementCtx,
) => {
  if (schedule.repeatType === "weekly") {
    if (schedule.repeatWeekdays.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "weekdays_required",
        path: ["schedule", "repeatWeekdays"],
      });
    }

    if (schedule.repeatWeekdays.some((day) => day < 1 || day > 7)) {
      ctx.addIssue({
        code: "custom",
        message: "incorrect_weekday",
        path: ["schedule", "repeatWeekdays"],
      });
    }
  }

  if (schedule.endDate && schedule.endDate < startDate) {
    ctx.addIssue({
      code: "custom",
      message: "end_date_gte_start_date",
      path: ["schedule", "endDate"],
    });
  }
};

export const plannedCreateSchema = z
  .object({ data: transactionInputSchema, schedule: scheduleFieldsSchema })
  .superRefine((value, ctx) =>
    checkSchedule(value.schedule, value.data.date, ctx),
  );

export const scheduleUpdateSchema = z
  .object({
    /** Any occurrence or schedule leg id of the schedule being edited */
    scheduleId: idSchema,
    data: transactionInputSchema,
    schedule: scheduleFieldsSchema.extend({
      repeatType: z.enum(REPEAT_TYPES),
    }),
  })
  .superRefine((value, ctx) =>
    checkSchedule(value.schedule, value.data.date, ctx),
  );
