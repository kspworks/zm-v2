"use client";

import { getISODay, parseISO } from "date-fns";
import { useTranslations } from "next-intl";

import { DatePicker } from "~/components/app/date-picker";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { REPEAT_OPTIONS } from "~/lib/validators/planned";

export type RepeatState = {
  repeatType: (typeof REPEAT_OPTIONS)[number];
  repeatInterval: number;
  repeatWeekdays: number[];
  endDate: string | null;
};

/** Defaults: no repeat, every 1, the start date's weekday, no end */
export const defaultRepeat = (startDate: string): RepeatState => ({
  repeatType: "none",
  repeatInterval: 1,
  repeatWeekdays: [getISODay(parseISO(startDate))],
  endDate: null,
});

export const repeatErrors = (repeat: RepeatState, startDate: string) => ({
  weekdays:
    repeat.repeatType === "weekly" && repeat.repeatWeekdays.length === 0
      ? ("weekdays_required" as const)
      : null,
  interval:
    !Number.isInteger(repeat.repeatInterval) ||
    repeat.repeatInterval < 1 ||
    repeat.repeatInterval > 31,
  endDate:
    repeat.endDate && repeat.endDate < startDate
      ? ("end_date_gte_start_date" as const)
      : null,
});

const WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;

export function RepeatFields({
  value,
  onChange,
  startDate,
  allowNone = true,
  showErrors,
}: {
  value: RepeatState;
  onChange: (value: RepeatState) => void;
  startDate: string;
  allowNone?: boolean;
  showErrors: boolean;
}) {
  const t = useTranslations("form");
  const te = useTranslations("errors");
  const errors = repeatErrors(value, startDate);
  const repeating = value.repeatType !== "none";

  return (
    <FieldSet className="rounded-lg border p-3">
      <FieldGroup className="gap-3">
        <div className="grid grid-cols-[1.4fr_1fr] gap-3">
          <Field>
            <FieldLabel htmlFor="repeat-type">{t("repeat")}</FieldLabel>
            <Select
              value={value.repeatType}
              onValueChange={(repeatType) =>
                onChange({
                  ...value,
                  repeatType: repeatType as RepeatState["repeatType"],
                })
              }
            >
              <SelectTrigger id="repeat-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPEAT_OPTIONS.filter((o) => allowNone || o !== "none").map(
                  (option) => (
                    <SelectItem key={option} value={option}>
                      {t(`repeatTypes.${option}`)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </Field>
          {repeating ? (
            <Field data-invalid={showErrors && errors.interval}>
              <FieldLabel htmlFor="repeat-interval">{t("interval")}</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="repeat-interval"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={31}
                  className="w-16 tabular-nums"
                  // NaN stands for an empty field while the user is typing
                  value={
                    Number.isNaN(value.repeatInterval)
                      ? ""
                      : value.repeatInterval
                  }
                  aria-invalid={showErrors && errors.interval}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      repeatInterval:
                        event.target.value === ""
                          ? Number.NaN
                          : Number(event.target.value),
                    })
                  }
                  onBlur={(event) => {
                    const interval = Math.min(
                      31,
                      Math.max(1, Math.round(value.repeatInterval) || 1),
                    );

                    // drop leading zeros React leaves in place ("01" == 1)
                    event.currentTarget.value = String(interval);

                    if (interval !== value.repeatInterval) {
                      onChange({ ...value, repeatInterval: interval });
                    }
                  }}
                />
                <span className="text-muted-foreground text-sm">
                  {value.repeatType === "none"
                    ? null
                    : t(`intervalUnit.${value.repeatType}`, {
                        count: value.repeatInterval || 1,
                      })}
                </span>
              </div>
            </Field>
          ) : null}
        </div>

        {value.repeatType === "weekly" ? (
          <Field data-invalid={showErrors && !!errors.weekdays}>
            <FieldLabel>{t("weekdays")}</FieldLabel>
            <ToggleGroup
              type="multiple"
              variant="outline"
              className="w-full"
              value={value.repeatWeekdays.map(String)}
              onValueChange={(days) =>
                onChange({
                  ...value,
                  repeatWeekdays: days.map(Number).sort((a, b) => a - b),
                })
              }
            >
              {WEEKDAYS.map((day) => (
                <ToggleGroupItem key={day} value={day} className="flex-1 px-0">
                  {t(`weekdayNames.${day}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {showErrors && errors.weekdays ? (
              <FieldError>{te(errors.weekdays)}</FieldError>
            ) : null}
          </Field>
        ) : null}

        {repeating ? (
          <Field data-invalid={showErrors && !!errors.endDate}>
            <FieldLabel htmlFor="repeat-end">{t("endDate")}</FieldLabel>
            <DatePicker
              id="repeat-end"
              value={value.endDate}
              clearable
              placeholder={t("noEndDate")}
              invalid={showErrors && !!errors.endDate}
              onChange={(endDate) => onChange({ ...value, endDate })}
            />
            {showErrors && errors.endDate ? (
              <FieldError>{te(errors.endDate)}</FieldError>
            ) : null}
          </Field>
        ) : null}
      </FieldGroup>
    </FieldSet>
  );
}
