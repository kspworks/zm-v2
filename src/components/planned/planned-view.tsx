"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { CalendarClockIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  type PlannedDialogState,
  PlannedFormDialog,
} from "~/components/planned/planned-form-dialog";
import {
  DeleteTransactionDialog,
  PlannedRowMenu,
} from "~/components/planned/planned-row-actions";
import { BalancesSidebar } from "~/components/transactions/balances-sidebar";
import { FilterBar } from "~/components/transactions/filter-bar";
import { LedgerLayout } from "~/components/transactions/ledger-layout";
import {
  type TransactionDialogState,
  TransactionFormDialog,
} from "~/components/transactions/transaction-form-dialog";
import { TransactionGroups } from "~/components/transactions/transaction-groups";
import type { TransactionRowData } from "~/components/transactions/transaction-item";
import { useTransactionFilter } from "~/components/transactions/use-filter";
import { Button } from "~/components/ui/button";
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

export function PlannedView() {
  const t = useTranslations("planned");
  const tt = useTranslations("transactions");
  const trpc = useTRPC();
  const { state, setState, filter, reset } = useTransactionFilter();
  const filtering = isFilterActive(filter);

  const [submitting, setSubmitting] = useState<TransactionDialogState>(null);
  const [dialog, setDialog] = useState<PlannedDialogState>(null);
  const [deleting, setDeleting] = useState<TransactionRowData | null>(null);

  const list = useInfiniteQuery(
    trpc.transactions.planned.infiniteQueryOptions(
      { filter },
      { getNextPageParam: (page) => page.nextCursor },
    ),
  );
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <LedgerLayout
      title={t("title")}
      actions={
        <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
          <PlusIcon />
          <span className="max-sm:sr-only">{t("add")}</span>
        </Button>
      }
      sidebar={
        <BalancesSidebar
          selectedAccounts={state.accounts}
          onToggleAccount={(id) =>
            void setState({
              accounts: state.accounts.includes(id)
                ? state.accounts.filter((a) => a !== id)
                : [...state.accounts, id],
            })
          }
        />
      }
    >
      <FilterBar state={state} setState={setState} reset={reset} />

      {list.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClockIcon />
            </EmptyMedia>
            <EmptyTitle>
              {filtering ? tt("emptyFiltered") : t("empty")}
            </EmptyTitle>
            {filtering ? null : (
              <EmptyDescription>{t("emptyHint")}</EmptyDescription>
            )}
          </EmptyHeader>
          {filtering ? null : (
            <EmptyContent>
              <Button onClick={() => setDialog({ mode: "create" })}>
                <PlusIcon />
                {t("add")}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <TransactionGroups
            rows={rows}
            planned
            actions={(row) => (
              <PlannedRowMenu
                row={row}
                onSubmit={() => setSubmitting({ mode: "submit", row })}
                onEditSchedule={() => setDialog({ mode: "schedule", row })}
                onDelete={() => setDeleting(row)}
              />
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
              {tt("loadMore")}
            </Button>
          ) : null}
        </>
      )}

      <TransactionFormDialog
        state={submitting}
        onClose={() => setSubmitting(null)}
      />
      <PlannedFormDialog state={dialog} onClose={() => setDialog(null)} />
      <DeleteTransactionDialog
        row={deleting}
        onClose={() => setDeleting(null)}
      />
    </LedgerLayout>
  );
}
