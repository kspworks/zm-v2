"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import {
  defaultRepeat,
  RepeatFields,
  type RepeatState,
  repeatErrors,
} from "~/components/planned/repeat-fields";
import {
  TransactionForm,
  useInvalidateMoney,
  valuesFromRow,
} from "~/components/transactions/transaction-form";
import { useToday } from "~/components/transactions/transaction-groups";
import type { TransactionRowData } from "~/components/transactions/transaction-item";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { formatDisplayDate } from "~/lib/dates";
import { useTRPC } from "~/trpc/react";

export type PlannedDialogState =
  | { mode: "create" }
  | { mode: "schedule"; row: TransactionRowData }
  | null;

const hasErrors = (repeat: RepeatState, startDate: string) => {
  const errors = repeatErrors(repeat, startDate);

  return (
    repeat.repeatType !== "none" &&
    (!!errors.weekdays || errors.interval || !!errors.endDate)
  );
};

function PlannedForm({
  state,
  onClose,
}: {
  state: NonNullable<PlannedDialogState>;
  onClose: () => void;
}) {
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const today = useToday();
  const invalidate = useInvalidateMoney();
  const row = state.mode === "schedule" ? state.row : null;
  const scheduleId = row?.plannedTransactionId ?? "";

  const schedule = useQuery({
    ...trpc.planned.schedule.queryOptions({ id: scheduleId }),
    enabled: row !== null,
  });

  const initial = row
    ? { ...valuesFromRow(row), date: schedule.data?.startDate ?? row.date }
    : undefined;

  const [repeat, setRepeat] = useState<RepeatState>(() =>
    defaultRepeat(initial?.date ?? today),
  );
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(initial?.date ?? today);
  const [showErrors, setShowErrors] = useState(false);
  const [dirty, setDirty] = useState(false);

  // take the stored rule once it arrives
  if (schedule.data && loadedFor !== schedule.data.id) {
    setLoadedFor(schedule.data.id);
    setStartDate(schedule.data.startDate);
    setRepeat({
      repeatType: schedule.data.repeatType,
      repeatInterval: schedule.data.repeatInterval,
      repeatWeekdays: schedule.data.repeatWeekdays,
      endDate: schedule.data.endDate,
    });
  }

  const create = useMutation(trpc.planned.create.mutationOptions());
  const update = useMutation(trpc.planned.updateSchedule.mutationOptions());

  if (row && !schedule.data) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <TransactionForm
      formId="planned-form"
      mode={row ? "edit" : "create"}
      initial={initial}
      usedAccountIds={
        row
          ? [row.account.id, row.linked?.account.id ?? ""].filter(Boolean)
          : []
      }
      kindLocked={row !== null}
      onDirtyChange={setDirty}
      onDone={onClose}
      describeDate={(date) =>
        repeat.repeatType === "none"
          ? formatDisplayDate(date)
          : `${formatDisplayDate(date)} – ${
              repeat.endDate ? formatDisplayDate(repeat.endDate) : "…"
            }`
      }
      extraValid={(values) => {
        setShowErrors(true);
        setStartDate(values.date);

        return !hasErrors(repeat, values.date);
      }}
      extraFields={
        <RepeatFields
          value={repeat}
          onChange={setRepeat}
          startDate={startDate}
          allowNone={row === null}
          showErrors={showErrors}
        />
      }
      onSubmit={async (input) => {
        if (row && repeat.repeatType !== "none") {
          await update.mutateAsync({
            scheduleId,
            data: input,
            schedule: { ...repeat, repeatType: repeat.repeatType },
          });
        } else {
          await create.mutateAsync({ data: input, schedule: repeat });
        }

        await invalidate();

        return { balances: [] };
      }}
      footer={({ pending }) => (
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {dirty ? tc("cancel") : tc("close")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {tc("save")}
          </Button>
        </div>
      )}
    />
  );
}

/** Create a planned transaction or schedule, or edit a schedule */
export function PlannedFormDialog({
  state,
  onClose,
}: {
  state: PlannedDialogState;
  onClose: () => void;
}) {
  const t = useTranslations("form");
  const tt = useTranslations("transactions");

  return (
    <ResponsiveDialog
      open={state !== null}
      onOpenChange={(open) => !open && onClose()}
      title={state?.mode === "schedule" ? tt("editSchedule") : t("createTitle")}
    >
      {state ? (
        <PlannedForm
          key={state.mode === "schedule" ? state.row.id : "create"}
          state={state}
          onClose={onClose}
        />
      ) : null}
    </ResponsiveDialog>
  );
}
