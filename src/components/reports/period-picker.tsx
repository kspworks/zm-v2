"use client";

import { format, parseISO, setMonth } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { DatePicker } from "~/components/app/date-picker";
import { Button } from "~/components/ui/button";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Separator } from "~/components/ui/separator";
import type { Locale } from "~/i18n/config";
import { dateFnsLocale } from "~/lib/dates";
import { isWholeMonth, monthOf, type Period, shiftPeriod } from "~/lib/period";
import { cn } from "~/lib/utils";

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** "Вересень 2026" for a whole month, else "01.09 –" and "15.09.2026" */
const periodLabel = (
  period: Period,
  locale: Locale,
): { month: string; short: string } | { from: string; to: string } => {
  const start = parseISO(period.startDate);
  const options = { locale: dateFnsLocale(locale) };

  if (isWholeMonth(period)) {
    return {
      month: capitalize(format(start, "LLLL yyyy", options)),
      short: capitalize(format(start, "LLL yyyy", options)),
    };
  }

  const sameYear = period.startDate.slice(0, 4) === period.endDate.slice(0, 4);

  return {
    from: `${format(start, sameYear ? "dd.MM" : "dd.MM.yyyy")} –`,
    to: format(parseISO(period.endDate), "dd.MM.yyyy"),
  };
};

/**
 * A period as ‹ label ›: the arrows step to the neighbouring period, the
 * label opens a month grid and a custom range. In a narrow table (the
 * `@container` is below 4xl) only the label shows, and a range wraps.
 */
export function PeriodPicker({
  value,
  onChange,
  label,
  className,
}: {
  value: Period;
  onChange: (value: Period) => void;
  label: string;
  className?: string;
}) {
  const t = useTranslations("reports");
  const tf = useTranslations("filters");
  const te = useTranslations("errors");
  const locale = useLocale() as Locale;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.startDate.slice(0, 4)));
  const [draft, setDraft] = useState(value);

  // reopen on the period's own year and dates
  useEffect(() => {
    if (open) {
      setYear(Number(value.startDate.slice(0, 4)));
      setDraft(value);
    }
  }, [open, value]);

  const reversed = draft.startDate > draft.endDate;
  const text = periodLabel(value, locale);
  const selectedMonth = isWholeMonth(value) ? value.startDate : null;

  const updateDraft = (next: Period) => {
    setDraft(next);

    if (next.startDate <= next.endDate) {
      onChange(next);
    }
  };

  return (
    <fieldset
      aria-label={label}
      className={cn("flex w-full min-w-0 gap-1", className)}
    >
      <Button
        variant="outline"
        size="icon"
        className="@max-4xl:hidden"
        aria-label={t("previousPeriod")}
        onClick={() => onChange(shiftPeriod(value, -1))}
      >
        <ChevronLeftIcon />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-auto min-h-8 min-w-0 flex-1 flex-wrap gap-x-1 gap-y-0 px-1.5 py-1 font-normal @max-4xl:text-xs tabular-nums"
          >
            {"month" in text ? (
              <>
                <span className="@max-4xl:hidden truncate">{text.month}</span>
                <span className="@4xl:hidden truncate">{text.short}</span>
              </>
            ) : (
              <>
                <span>{text.from}</span>
                <span>{text.to}</span>
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-72 flex-col gap-3">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("previousYear")}
              onClick={() => setYear(year - 1)}
            >
              <ChevronLeftIcon />
            </Button>
            <span className="font-medium text-sm tabular-nums">{year}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("nextYear")}
              onClick={() => setYear(year + 1)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 12 }, (_, month) => {
              const start = format(
                setMonth(parseISO(`${year}-01-01`), month),
                "yyyy-MM-dd",
              );

              return (
                <Button
                  key={start}
                  size="sm"
                  variant={selectedMonth === start ? "default" : "ghost"}
                  onClick={() => {
                    onChange(monthOf(start));
                    setOpen(false);
                  }}
                >
                  {capitalize(
                    format(parseISO(start), "LLL", {
                      locale: dateFnsLocale(locale),
                    }),
                  )}
                </Button>
              );
            })}
          </div>
          <Separator />
          <span className="font-medium text-sm">{t("customRange")}</span>
          <div className="grid grid-cols-2 gap-2">
            <Field data-invalid={reversed}>
              <FieldLabel htmlFor={`${id}-from`}>{tf("from")}</FieldLabel>
              <DatePicker
                id={`${id}-from`}
                value={draft.startDate}
                invalid={reversed}
                onChange={(date) => {
                  if (date) {
                    updateDraft({ ...draft, startDate: date });
                  }
                }}
              />
            </Field>
            <Field data-invalid={reversed}>
              <FieldLabel htmlFor={`${id}-to`}>{tf("to")}</FieldLabel>
              <DatePicker
                id={`${id}-to`}
                value={draft.endDate}
                invalid={reversed}
                onChange={(date) => {
                  if (date) {
                    updateDraft({ ...draft, endDate: date });
                  }
                }}
              />
            </Field>
          </div>
          {reversed ? (
            <FieldError>{te("start_date_lte_end_date")}</FieldError>
          ) : null}
        </PopoverContent>
      </Popover>
      <Button
        variant="outline"
        size="icon"
        className="@max-4xl:hidden"
        aria-label={t("nextPeriod")}
        onClick={() => onChange(shiftPeriod(value, 1))}
      >
        <ChevronRightIcon />
      </Button>
    </fieldset>
  );
}
