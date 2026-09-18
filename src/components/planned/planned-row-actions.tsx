"use client";

import { useMutation } from "@tanstack/react-query";
import { CalendarCogIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { RowMenu } from "~/components/transactions/row-menu";
import { useInvalidateMoney } from "~/components/transactions/transaction-form";
import type { TransactionRowData } from "~/components/transactions/transaction-item";
import { AlertDialogAction } from "~/components/ui/alert-dialog";
import { buttonVariants } from "~/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { useToastError } from "~/hooks/use-toast-error";
import { useTRPC } from "~/trpc/react";

export const isRecurring = (row: TransactionRowData) =>
  row.plannedTransactionId !== null && row.schedule !== null;

/** Submit with changes, Edit schedule (recurring only), Delete */
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

  return (
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
  const trpc = useTRPC();
  const toastError = useToastError();
  const invalidate = useInvalidateMoney();

  const onSuccess = async () => {
    toast.success(t("toast.deleted"));
    onClose();
    await invalidate();
  };

  const removeOne = useMutation(
    trpc.transactions.delete.mutationOptions({
      onSuccess,
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
