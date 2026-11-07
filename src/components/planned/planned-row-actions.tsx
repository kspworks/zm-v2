"use client";

import { useMutation } from "@tanstack/react-query";
import { CalendarCogIcon, CheckIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { RowMenu } from "~/components/transactions/row-menu";
import { useInvalidateMoney } from "~/components/transactions/transaction-form";
import { useToday } from "~/components/transactions/transaction-groups";
import type { TransactionRowData } from "~/components/transactions/transaction-item";
import { AlertDialogAction } from "~/components/ui/alert-dialog";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { useToastError } from "~/hooks/use-toast-error";
import { useTRPC } from "~/trpc/react";

/** Long enough to notice a slip and reach the button */
const UNDO_MS = 10_000;

export const isRecurring = (row: TransactionRowData) =>
  row.plannedTransactionId !== null && row.schedule !== null;

/** Confirms the row exactly as planned, with Undo for a slip */
function MarkPaidButton({ id }: { id: string }) {
  const t = useTranslations("transactions");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const toastError = useToastError();
  const invalidate = useInvalidateMoney();

  const unsubmit = useMutation(
    trpc.transactions.unsubmit.mutationOptions({
      onSuccess: async () => {
        toast.success(t("toast.backToPlanned"));
        await invalidate();
      },
      onError: toastError,
    }),
  );
  const submit = useMutation(
    trpc.transactions.submit.mutationOptions({
      onSuccess: async () => {
        toast.success(t("toast.paid"), {
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
      {row.date <= today ? <MarkPaidButton id={row.id} /> : null}
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

  const onSuccess = async () => {
    toast.success(t("toast.deleted"));
    onClose();
    await invalidate();
  };

  const restore = useMutation(
    trpc.transactions.restore.mutationOptions({
      onSuccess: async () => {
        toast.success(t("toast.restored"));
        await invalidate();
      },
      onError: toastError,
    }),
  );
  const removeOne = useMutation(
    trpc.transactions.delete.mutationOptions({
      onSuccess: async (_result, { id }) => {
        toast.success(t("toast.deleted"), {
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
    trpc.planned.deleteAll.mutationOptions({ onSuccess, onError: toastError }),
  );
  const pending = removeOne.isPending || removeAll.isPending;
  const recurring = row?.isPlanned && isRecurring(row);

  if (recurring) {
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={t("deleteRecurringTitle")}
        description={t("deleteRecurringDescription")}
        confirmLabel={t("deleteAllPlanned")}
        pending={pending}
        onConfirm={() => removeAll.mutate({ id: row.id })}
        extraActions={
          <AlertDialogAction
            className={buttonVariants({ variant: "outline" })}
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              removeOne.mutate({ id: row.id });
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
      onConfirm={() => row && removeOne.mutate({ id: row.id })}
    />
  );
}
