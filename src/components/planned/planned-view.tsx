"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { CalendarClockIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BalancesSidebar } from "~/components/app/balances-sidebar";
import { LedgerLayout } from "~/components/app/ledger-layout";
import {
  LoadingRegion,
  TransactionListSkeleton,
} from "~/components/app/skeletons";
import {
  type PlannedDialogState,
  PlannedFormDialog,
} from "~/components/planned/planned-form-dialog";
import {
  DeleteTransactionDialog,
  PlannedRowMenu,
} from "~/components/planned/planned-row-actions";
import { FilterButton } from "~/components/transactions/filter-bar";
import { FilterSummary } from "~/components/transactions/filter-summary";
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useLocalStorage } from "~/hooks/use-local-storage";
import { isFilterActive } from "~/lib/validators/transactions";
import { useTRPC } from "~/trpc/react";

const viewSchema = Schema.Literals(["next", "all"]);

export function PlannedView() {
  const t = useTranslations("planned");
  const tt = useTranslations("transactions");
  const trpc = useTRPC();
  const { state, setState, filter, reset } = useTransactionFilter();
  const filtering = isFilterActive(filter);

  const [submitting, setSubmitting] = useState<TransactionDialogState>(null);
  const [dialog, setDialog] = useState<PlannedDialogState>(null);
  const [deleting, setDeleting] = useState<TransactionRowData | null>(null);

  // a repeating payment is one row until the reader asks for every date; a
  // date filter asks for exactly that
  const [view, setView, ready] = useLocalStorage(
    "zm.planned.view",
    viewSchema,
    "next",
  );
  const dated = !!filter.startDate || !!filter.endDate;
  const nextOnly = view === "next" && !dated;

  const list = useInfiniteQuery(
    trpc.transactions.planned.infiniteQueryOptions(
      { filter, nextOnly },
      { getNextPageParam: (page) => page.nextCursor, enabled: ready },
    ),
  );
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <LedgerLayout
      title={t("title")}
      filters={<FilterButton state={state} setState={setState} reset={reset} />}
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
      <FilterSummary state={state} setState={setState} reset={reset} />
      {filtering ? <TotalsBar filter={filter} planned /> : null}
      {dated ? null : (
        <Tabs
          value={view}
          onValueChange={(value) =>
            setView(Schema.decodeUnknownSync(viewSchema)(value))
          }
        >
          <TabsList aria-label={t("view")}>
            <TabsTrigger value="next">{t("viewNext")}</TabsTrigger>
            <TabsTrigger value="all">{t("viewAll")}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {list.isPending ? (
        <LoadingRegion>
          <TransactionListSkeleton />
        </LoadingRegion>
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
            onOpen={(row) => setSubmitting({ mode: "submit", row })}
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
