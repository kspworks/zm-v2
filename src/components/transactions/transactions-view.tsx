"use client";

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRightIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { PageHeader } from "~/components/app/page-header";
import { BalancesSidebar } from "~/components/transactions/balances-sidebar";
import { FilterBar } from "~/components/transactions/filter-bar";
import { TotalsBar } from "~/components/transactions/totals-bar";
import { useInvalidateMoney } from "~/components/transactions/transaction-form";
import {
  type TransactionDialogState,
  TransactionFormDialog,
} from "~/components/transactions/transaction-form-dialog";
import { TransactionGroups } from "~/components/transactions/transaction-groups";
import {
  TransactionItem,
  type TransactionRowData,
} from "~/components/transactions/transaction-item";
import { useTransactionFilter } from "~/components/transactions/use-filter";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { useToastError } from "~/hooks/use-toast-error";
import { isFilterActive } from "~/lib/validators/transactions";
import { useTRPC } from "~/trpc/react";

/** Page shell shared by the Transactions and Planned pages */
export function LedgerLayout({
  title,
  actions,
  sidebar,
  children,
}: {
  title: string;
  actions?: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("sidebar");
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              className="lg:hidden"
              aria-label={t("title")}
              onClick={() => setSheetOpen(true)}
            >
              <WalletIcon />
            </Button>
            {actions}
          </>
        }
      />
      <div className="mx-auto grid w-full max-w-6xl gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
        <aside className="hidden lg:block">
          <div className="sticky top-20">{sidebar}</div>
        </aside>
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-80 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("title")}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">{sidebar}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function RowMenu({ children }: { children: ReactNode }) {
  const tc = useTranslations("common");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={tc("actions")}>
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TransactionsView() {
  const t = useTranslations("transactions");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const toastError = useToastError();
  const invalidate = useInvalidateMoney();
  const { state, setState, filter, reset } = useTransactionFilter();
  const filtering = isFilterActive(filter);

  const [dialog, setDialog] = useState<TransactionDialogState>(null);
  const [deleting, setDeleting] = useState<TransactionRowData | null>(null);

  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const overdue = useQuery(trpc.transactions.overdue.queryOptions({ filter }));
  const list = useInfiniteQuery(
    trpc.transactions.list.infiniteQueryOptions(
      { filter },
      { getNextPageParam: (page) => page.nextCursor },
    ),
  );

  const remove = useMutation(
    trpc.transactions.delete.mutationOptions({
      onSuccess: async () => {
        toast.success(t("toast.deleted"));
        setDeleting(null);
        await invalidate();
      },
      onError: toastError,
    }),
  );

  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const hasAccounts = (accounts.data?.length ?? 0) > 0;

  const toggleAccount = (id: string) =>
    void setState({
      accounts: state.accounts.includes(id)
        ? state.accounts.filter((a) => a !== id)
        : [...state.accounts, id],
    });

  const addButton = (
    <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
      <PlusIcon />
      <span className="max-sm:sr-only">{t("add")}</span>
    </Button>
  );

  return (
    <LedgerLayout
      title={t("title")}
      actions={addButton}
      sidebar={
        <BalancesSidebar
          selectedAccounts={state.accounts}
          onToggleAccount={toggleAccount}
        />
      }
    >
      <FilterBar state={state} setState={setState} reset={reset} />

      {filtering ? <TotalsBar filter={filter} /> : null}

      {overdue.data && overdue.data.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-amber-500/40 bg-amber-500/5">
          <h2 className="px-3 pt-3 pb-1 font-semibold text-amber-700 text-sm sm:px-4 dark:text-amber-400">
            {t("overdueTitle")}
          </h2>
          <div className="divide-y divide-amber-500/20">
            {overdue.data.map((row) => (
              <TransactionItem
                key={row.id}
                row={row}
                actions={
                  <RowMenu>
                    <DropdownMenuItem
                      onSelect={() => setDialog({ mode: "submit", row })}
                    >
                      <SendIcon />
                      {t("submitWithChanges")}
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
                }
              />
            ))}
          </div>
        </section>
      ) : null}

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
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle")}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </LedgerLayout>
  );
}
