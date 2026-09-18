"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRightIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import {
  type PlannedDialogState,
  PlannedFormDialog,
} from "~/components/planned/planned-form-dialog";
import { DeleteTransactionDialog } from "~/components/planned/planned-row-actions";
import { BalancesSidebar } from "~/components/transactions/balances-sidebar";
import { FilterBar } from "~/components/transactions/filter-bar";
import { LedgerLayout } from "~/components/transactions/ledger-layout";
import { OverdueBlock } from "~/components/transactions/overdue-block";
import { RowMenu } from "~/components/transactions/row-menu";
import { TotalsBar } from "~/components/transactions/totals-bar";
import {
  type TransactionDialogState,
  TransactionFormDialog,
} from "~/components/transactions/transaction-form-dialog";
import { TransactionGroups } from "~/components/transactions/transaction-groups";
import type { TransactionRowData } from "~/components/transactions/transaction-item";
import { useTransactionFilter } from "~/components/transactions/use-filter";
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
import { Spinner } from "~/components/ui/spinner";
import { isFilterActive } from "~/lib/validators/transactions";
import { useTRPC } from "~/trpc/react";

export function TransactionsView({
  extraActions,
}: {
  extraActions?: ReactNode;
}) {
  const t = useTranslations("transactions");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const { state, setState, filter, reset } = useTransactionFilter();
  const filtering = isFilterActive(filter);

  const [dialog, setDialog] = useState<TransactionDialogState>(null);
  const [plannedDialog, setPlannedDialog] = useState<PlannedDialogState>(null);
  const [deleting, setDeleting] = useState<TransactionRowData | null>(null);

  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const list = useInfiniteQuery(
    trpc.transactions.list.infiniteQueryOptions(
      { filter },
      { getNextPageParam: (page) => page.nextCursor },
    ),
  );

  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const hasAccounts = (accounts.data?.length ?? 0) > 0;

  const toggleAccount = (id: string) =>
    void setState({
      accounts: state.accounts.includes(id)
        ? state.accounts.filter((a) => a !== id)
        : [...state.accounts, id],
    });

  return (
    <LedgerLayout
      title={t("title")}
      actions={
        <>
          {extraActions}
          <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
            <PlusIcon />
            <span className="max-sm:sr-only">{t("add")}</span>
          </Button>
        </>
      }
      sidebar={
        <BalancesSidebar
          selectedAccounts={state.accounts}
          onToggleAccount={toggleAccount}
        />
      }
    >
      <FilterBar state={state} setState={setState} reset={reset} />

      {filtering ? <TotalsBar filter={filter} /> : null}

      <OverdueBlock
        filter={filter}
        onSubmit={(row) => setDialog({ mode: "submit", row })}
        onEditSchedule={(row) => setPlannedDialog({ mode: "schedule", row })}
        onDelete={setDeleting}
      />

      {list.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArrowLeftRightIcon />
            </EmptyMedia>
            <EmptyTitle>
              {filtering ? t("emptyFiltered") : t("empty")}
            </EmptyTitle>
            {filtering ? null : (
              <EmptyDescription>
                {hasAccounts ? t("emptyHint") : t("emptyNoAccounts")}
              </EmptyDescription>
            )}
          </EmptyHeader>
          {filtering ? null : (
            <EmptyContent>
              {hasAccounts ? (
                <Button onClick={() => setDialog({ mode: "create" })}>
                  <PlusIcon />
                  {t("add")}
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/accounts">{tc("createAccountLink")}</Link>
                </Button>
              )}
              <Button variant="link" asChild>
                <Link href="/import">{t("orImport")}</Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <TransactionGroups
            rows={rows}
            planned={false}
            actions={(row) => (
              <RowMenu>
                <DropdownMenuItem
                  onSelect={() => setDialog({ mode: "edit", row })}
                >
                  <PencilIcon />
                  {tc("edit")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleting(row)}
                >
                  <Trash2Icon />
                  {tc("delete")}
                </DropdownMenuItem>
              </RowMenu>
            )}
          />
          {list.hasNextPage ? (
            <Button
              variant="outline"
              className="self-center"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? <Spinner /> : null}
              {t("loadMore")}
            </Button>
          ) : null}
        </>
      )}

      <TransactionFormDialog state={dialog} onClose={() => setDialog(null)} />
      <PlannedFormDialog
        state={plannedDialog}
        onClose={() => setPlannedDialog(null)}
      />
      <DeleteTransactionDialog
        row={deleting}
        onClose={() => setDeleting(null)}
      />
    </LedgerLayout>
  );
}
