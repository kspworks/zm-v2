"use client";

import { useQuery } from "@tanstack/react-query";

import { AccountFormDialog } from "~/components/accounts/account-form-dialog";
import type { QuickAddKey } from "~/components/app/nav-items";
import { CategoryFormDialog } from "~/components/categories/category-form-dialog";
import { PlannedFormDialog } from "~/components/planned/planned-form-dialog";
import { TransactionFormDialog } from "~/components/transactions/transaction-form-dialog";
import { useTRPC } from "~/trpc/react";

/**
 * The create dialogs behind the sidebar's "+" buttons. Only the last requested
 * one is mounted, so its queries run on first use rather than on every page,
 * and it stays mounted after closing so the close animation plays.
 */
export function QuickAddDialogs({
  kind,
  open,
  onClose,
}: {
  kind: QuickAddKey | null;
  open: boolean;
  onClose: () => void;
}) {
  switch (kind) {
    case "transactions":
      return (
        <TransactionFormDialog
          state={open ? { mode: "create" } : null}
          onClose={onClose}
        />
      );
    case "planned":
      return (
        <PlannedFormDialog
          state={open ? { mode: "create" } : null}
          onClose={onClose}
        />
      );
    case "accounts":
      return (
        <AccountFormDialog
          open={open}
          account={null}
          onOpenChange={(next) => !next && onClose()}
        />
      );
    case "categories":
      return <QuickAddCategory open={open} onClose={onClose} />;
    default:
      return null;
  }
}

function QuickAddCategory({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  // the parent select's options; the dialog fills them in once they arrive
  const categories = useQuery(trpc.categories.list.queryOptions());

  return (
    <CategoryFormDialog
      open={open}
      category={null}
      presetParentId={null}
      categories={categories.data ?? []}
      onOpenChange={(next) => !next && onClose()}
    />
  );
}
