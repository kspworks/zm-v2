"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, TargetIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { PageHeader } from "~/components/app/page-header";
import { BudgetFormDialog } from "~/components/budgets/budget-form-dialog";
import {
  type Budget,
  BudgetProgress,
  budgetName,
} from "~/components/budgets/budget-progress";
import { RowMenu } from "~/components/transactions/row-menu";
import { Button } from "~/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import { useToastError } from "~/hooks/use-toast-error";
import { useTRPC } from "~/trpc/react";

export function BudgetsView() {
  const t = useTranslations("budgets");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const list = useQuery(trpc.budgets.list.queryOptions());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);

  const remove = useMutation(
    trpc.budgets.delete.mutationOptions({
      onSuccess: async () => {
        toast.success(tc("deleted"));
        setDeleting(null);
        await queryClient.invalidateQueries(trpc.budgets.pathFilter());
      },
      onError: toastError,
    }),
  );

  const openForm = (budget: Budget | null) => {
    setEditing(budget);
    setFormOpen(true);
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <Button size="sm" onClick={() => openForm(null)}>
            <PlusIcon />
            <span className="max-sm:sr-only">{t("add")}</span>
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
        <p className="text-muted-foreground text-sm">{t("hint")}</p>
        {list.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : list.data?.length ? (
          <ul className="bg-card divide-y rounded-lg border">
            {list.data.map((budget) => (
              <li key={budget.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <BudgetProgress budget={budget} />
                </div>
                <RowMenu>
                  <DropdownMenuItem onSelect={() => openForm(budget)}>
                    <PencilIcon />
                    {tc("edit")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleting(budget)}
                  >
                    <Trash2Icon />
                    {tc("delete")}
                  </DropdownMenuItem>
                </RowMenu>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TargetIcon />
              </EmptyMedia>
              <EmptyTitle>{t("empty")}</EmptyTitle>
              <EmptyDescription>{t("emptyHint")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => openForm(null)}>
                <PlusIcon />
                {t("add")}
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </div>

      <BudgetFormDialog
        open={formOpen}
        budget={editing}
        onOpenChange={setFormOpen}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle", { name: deleting ? budgetName(deleting) : "" })}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </>
  );
}
