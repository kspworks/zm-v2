"use client";

import { useTranslations } from "next-intl";

import { useToday } from "~/components/transactions/transaction-groups";
import { Button } from "~/components/ui/button";
import { PERIOD_PRESETS, type Period, presetPeriod } from "~/lib/period";

/** Quick ranges, so the common ones never need the date pickers */
export function PeriodPresets({
  value,
  onSelect,
}: {
  value: Partial<Period>;
  onSelect: (period: Period) => void;
}) {
  const t = useTranslations("filters.presets");
  const today = useToday();

  return (
    <div className="flex flex-wrap gap-1">
      {PERIOD_PRESETS.map((preset) => {
        const period = presetPeriod(preset, today);
        const active =
          value.startDate === period.startDate &&
          value.endDate === period.endDate;

        return (
          <Button
            key={preset}
            type="button"
            size="xs"
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            onClick={() => onSelect(period)}
          >
            {t(preset)}
          </Button>
        );
      })}
    </div>
  );
}
