import { Schema } from "effect";

import { REPEAT_TYPES } from "~/lib/schedule";
import {
  calendarDateSchema,
  idSchema,
  maxLength,
  message,
  nullable,
  withDefault,
} from "~/lib/validators/common";
import { transactionInputSchema } from "~/lib/validators/transactions";

export const REPEAT_OPTIONS = ["none", ...REPEAT_TYPES] as const;

const scheduleFields = {
  repeatType: Schema.Literals(REPEAT_OPTIONS),
  repeatInterval: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 31 }, message("invalid_value")),
  ).pipe(withDefault(1)),
  repeatWeekdays: Schema.Array(Schema.Int)
    .check(maxLength(7))
    .pipe(withDefault([])),
  endDate: nullable(calendarDateSchema),
};

export const scheduleFieldsSchema = Schema.Struct(scheduleFields);

export type ScheduleFields = typeof scheduleFieldsSchema.Type;

type ScheduleInput = {
  data: { date: string };
  schedule: Pick<ScheduleFields, "repeatType" | "repeatWeekdays" | "endDate">;
};

/** Weekdays and the end date checked against the start (the form's date) */
const checkSchedule = Schema.makeFilter(({ data, schedule }: ScheduleInput) => {
  const issues: { path: string[]; issue: string }[] = [];

  if (schedule.repeatType === "weekly") {
    if (schedule.repeatWeekdays.length === 0) {
      issues.push({
        path: ["schedule", "repeatWeekdays"],
        issue: "weekdays_required",
      });
    }

    if (schedule.repeatWeekdays.some((day) => day < 1 || day > 7)) {
      issues.push({
        path: ["schedule", "repeatWeekdays"],
        issue: "incorrect_weekday",
      });
    }
  }

  if (schedule.endDate && schedule.endDate < data.date) {
    issues.push({
      path: ["schedule", "endDate"],
      issue: "end_date_gte_start_date",
    });
  }

  return issues.length > 0 ? issues : undefined;
});

export const plannedCreateSchema = Schema.Struct({
  data: transactionInputSchema,
  schedule: scheduleFieldsSchema,
}).check(checkSchedule);

export const scheduleUpdateSchema = Schema.Struct({
  /** Either leg's id (an occurrence's plannedTransactionId) */
  scheduleId: idSchema,
  data: transactionInputSchema,
  schedule: Schema.Struct({
    ...scheduleFields,
    repeatType: Schema.Literals(REPEAT_TYPES),
  }),
}).check(checkSchedule);
