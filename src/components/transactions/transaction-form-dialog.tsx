"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import {
  TransactionForm,
  useInvalidateMoney,
  valuesFromRow,
} from "~/components/transactions/transaction-form";
import type { TransactionRowData } from "~/components/transactions/transaction-item";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useTRPC } from "~/trpc/react";

export type TransactionDialogState =
  | { mode: "create" }
  | { mode: "edit"; row: TransactionRowData }
  | { mode: "submit"; row: TransactionRowData }
  | null;

/** Create, edit, or "submit with changes" (a planned occurrence) */
export function TransactionFormDialog({
  state,
  onClose,
}: {
  state: TransactionDialogState;
  onClose: () => void;
}) {
  const t = useTranslations("form");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const invalidate = useInvalidateMoney();
  const [dirty, setDirty] = useState(false);

  const create = useMutation(trpc.transactions.create.mutationOptions());
  const update = useMutation(trpc.transactions.update.mutationOptions());

  const row = state && state.mode !== "create" ? state.row : null;
  const title =
    state?.mode === "edit"
      ? t("editTitle")
      : state?.mode === "submit"
        ? t("submitTitle")
        : t("createTitle");

  return (
    <ResponsiveDialog
      open={state !== null}
      onOpenChange={(open) => !open && onClose()}
      title={title}
    >
      {state ? (
        <TransactionForm
          key={row?.id ?? "create"}
          formId="transaction-form"
          mode={state.mode}
          initial={row ? valuesFromRow(row) : undefined}
          usedAccountIds={
            row
              ? [row.account.id, row.linked?.account.id ?? ""].filter(Boolean)
              : []
          }
          kindLocked={row !== null}
          onDirtyChange={setDirty}
          onDone={onClose}
          onSubmit={async (input) => {
            const result = row
              ? await update.mutateAsync({ id: row.id, data: input })
              : await create.mutateAsync(input);

            await invalidate();

            return result;
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
      ) : null}
    </ResponsiveDialog>
  );
}
