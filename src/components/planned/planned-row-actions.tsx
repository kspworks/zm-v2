"use client";

import { useMutation } from "@tanstack/react-query";
import { CalendarCogIcon, CheckIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { RowMenu } from "~/components/transactions/row-menu";
import { useInvalidateMoney } from "~/components/transactions/transaction-form";
import { useToday } from "~/components/transactions/transaction-groups";
import {
  type TransactionRowData,
  useRowSummary,
} from "~/components/transactions/transaction-item";
import { AlertDialogAction } from "~/components/ui/alert-dialog";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { useToastError } from "~/hooks/use-toast-error";
import type { Locale } from "~/i18n/config";
import { describeSchedule } from "~/lib/describe-schedule";
import { useTRPC } from "~/trpc/react";

/** Long enough to notice a slip and reach the button */
const UNDO_MS = 10_000;

export const isRecurring = (row: TransactionRowData) =>
  row.plannedTransactionId !== null && row.schedule !== null;

/**
 * Confirms the row exactly as planned, with Undo for a slip. The toasts name
 * the row, so the Undo of one of several stacked toasts is not a guess.
 */
function MarkPaidButton({ row }: { row: TransactionRowData }) {
  const t = useTranslations("transactions");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const toastError = useToastError();
  const invalidate = useInvalidateMoney();
  const { id } = row;
  // the button leaves with the paid row; its last callbacks keep this text
  const description = useRowSummary()(row);

  const unsubmit = useMutation(
    trpc.transactions.unsubmit.mutationOptions({
      onSuccess: async () => {
        toast.success(t("toast.backToPlanned"), { description });
        await invalidate();
      },
      onError: toastError,
    }),
  );
  const submit = useMutation(
    trpc.transactions.submit.mutationOptions({
      onSuccess: async () => {
        toast.success(t("toast.paid"), {
          description,
          duration: UNDO_MS,
          action: {
            label: tc("undo"),
            onClick: () => unsubmit.mutate({ id }),
          },
        });
        await invalidate();
      },
      onError: toastError,
    }),
  );

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={submit.isPending}
      aria-label={t("markPaid")}
      onClick={() => submit.mutate({ id })}
    >
      <CheckIcon />
      <span className="max-sm:hidden">{t("markPaid")}</span>
    </Button>
  );
}

/**
 * Mark as paid once the row is due, then Submit with changes, Edit schedule
 * (recurring only), Delete
 */
export function PlannedRowMenu({
  row,
  onSubmit,
  onEditSchedule,
  onDelete,
}: {
  row: TransactionRowData;
  onSubmit: () => void;
  onEditSchedule: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("transactions");
  const tc = useTranslations("common");
  const today = useToday();

  return (
    <div className="flex items-center gap-1">
      {row.date <= today ? <MarkPaidButton row={row} /> : null}
      <RowMenu>
        <DropdownMenuItem onSelect={onSubmit}>
          <SendIcon />
          {t("submitWithChanges")}
        </DropdownMenuItem>
        {isRecurring(row) ? (
          <DropdownMenuItem onSelect={onEditSchedule}>
            <CalendarCogIcon />
            {t("editSchedule")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon />
          {tc("delete")}
        </DropdownMenuItem>
      </RowMenu>
    </div>
  );
}

/**
 * Deleting a row: a recurring planned occurrence asks "Only this one" or
 * "All planned"; anything else gets a plain Yes/No.
 */
export function DeleteTransactionDialog({
  row,
  onClose,
}: {
  row: TransactionRowData | null;
  onClose: () => void;
}) {
  const t = useTranslations("transactions");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const toastError = useToastError();
  const invalidate = useInvalidateMoney();
  const locale = useLocale() as Locale;
  const rowSummary = useRowSummary();
  // the toasts name the row, since several deletes stack several toasts and
  // each Undo must say which row it brings back. The text is taken on
  // confirm, by id: the dialog's row is gone by the time Undo is clicked.
  const summaries = useRef(new Map<string, string>());

  const restore = useMutation(
    trpc.transactions.restore.mutationOptions({
      onSuccess: async (_result, { id }) => {
        toast.success(t("toast.restored"), {
          description: summaries.current.get(id),
        });
        await invalidate();
      },
      onError: toastError,
    }),
  );
  const removeOne = useMutation(
    trpc.transactions.delete.mutationOptions({
      onSuccess: async (_result, { id }) => {
        toast.success(t("toast.deleted"), {
          description: summaries.current.get(id),
          duration: UNDO_MS,
          action: { label: tc("undo"), onClick: () => restore.mutate({ id }) },
        });
        onClose();
        await invalidate();
      },
      onError: toastError,
    }),
  );
  const removeAll = useMutation(
    trpc.planned.deleteAll.mutationOptions({
      onSuccess: async (_result, { id }) => {
        toast.success(t("toast.deleted"), {
          description: summaries.current.get(id),
        });
        onClose();
        await invalidate();
      },
      onError: toastError,
    }),
  );
  const pending = removeOne.isPending || removeAll.isPending;
  const recurring = row?.isPlanned && isRecurring(row);

  const deleteOne = (target: TransactionRowData) => {
    summaries.current.set(target.id, rowSummary(target));
    removeOne.mutate({ id: target.id });
  };
  // the whole series: the schedule stands in for the date
  const deleteSeries = (target: TransactionRowData) => {
    summaries.current.set(
      target.id,
      rowSummary(
        target,
        target.schedule ? describeSchedule(target.schedule, locale) : undefined,
      ),
    );
    removeAll.mutate({ id: target.id });
  };

  if (recurring) {
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={t("deleteRecurringTitle")}
        description={t("deleteRecurringDescription")}
        confirmLabel={t("deleteAllPlanned")}
        pending={pending}
        onConfirm={() => deleteSeries(row)}
        extraActions={
          <AlertDialogAction
            className={buttonVariants({ variant: "outline" })}
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              deleteOne(row);
            }}
          >
            {t("deleteOnlyThis")}
          </AlertDialogAction>
        }
      />
    );
  }

  return (
    <ConfirmDialog
      open={row !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("deleteTitle")}
      pending={pending}
      onConfirm={() => row && deleteOne(row)}
    />
  );
}
