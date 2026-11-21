"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import {
  ChartPieIcon,
  EyeIcon,
  EyeOffIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  ReplaceIcon,
  Share2Icon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import { AfterHydration } from "~/components/app/after-hydration";
import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { LedgerLayout } from "~/components/app/ledger-layout";
import { LedgerCard, LedgerRow } from "~/components/app/ledger-list";
import { Money } from "~/components/app/money";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import { CategoriesPageSkeleton } from "~/components/app/route-skeletons";
import { ShareDialog } from "~/components/app/share-dialog";
import {
  CategoryListSkeleton,
  CHILD_INDENT,
  LoadingRegion,
  TabsSkeleton,
} from "~/components/app/skeletons";
import { CategoriesSidebar } from "~/components/categories/categories-sidebar";
import { CategoryFormDialog } from "~/components/categories/category-form-dialog";
import { RowMenu } from "~/components/transactions/row-menu";
import { useToday } from "~/components/transactions/transaction-groups";
import { Badge } from "~/components/ui/badge";
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
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useLocalStorage } from "~/hooks/use-local-storage";
import { usePrimaryCurrency } from "~/hooks/use-primary-currency";
import { useToastError } from "~/hooks/use-toast-error";
import { categoryOptions } from "~/lib/category-options";
import { monthOf } from "~/lib/period";
import { categoryColorOrder, SERIES_SLOTS, seriesColor } from "~/lib/report";
import { filteredHref } from "~/lib/transaction-links";
import { cn } from "~/lib/utils";
import { useTRPC } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/types";

type Category = RouterOutputs["categories"]["list"][number];

const viewSchema = Schema.Literals(["all", "expense", "income"]);

type Sum = { code: string; sign: string; amount: number };

export function CategoriesView() {
  return (
    <AfterHydration fallback={<CategoriesPageSkeleton />}>
      <Categories />
    </AfterHydration>
  );
}

function Categories() {
  const t = useTranslations("categories");
  const tc = useTranslations("common");
  const locale = useLocale();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const categories = useQuery(trpc.categories.list.queryOptions());
  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const primary = usePrimaryCurrency();
  const primaryCode = accounts.data?.find(
    (account) => account.currencyId === primary.currencyId,
  )?.currencyCode;

  const [view, setView, ready] = useLocalStorage(
    "zm.categories.view",
    viewSchema,
    "all",
  );

  // this calendar month's submitted rows, the same the report opens on
  const today = useToday();
  const month = useMemo(() => monthOf(today), [today]);
  const report = useQuery(trpc.reports.data.queryOptions({ filter: month }));

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [presetParentId, setPresetParentId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [replacing, setReplacing] = useState<Category | null>(null);
  const [targetId, setTargetId] = useState("");

  const remove = useMutation(
    trpc.categories.delete.mutationOptions({
      onSuccess: async () => {
        toast.success(tc("deleted"));
        setDeleting(null);
        await queryClient.invalidateQueries(trpc.categories.pathFilter());
      },
      onError: toastError,
    }),
  );

  const replace = useMutation(
    trpc.categories.replace.mutationOptions({
      onSuccess: async ({ moved }) => {
        toast.success(t("replaced", { count: moved }));
        setReplacing(null);
        // the moved rows show under the target everywhere
        await Promise.all(
          [
            trpc.categories,
            trpc.transactions,
            trpc.budgets,
            trpc.reports,
            trpc.dashboard,
            trpc.planned,
          ].map((router) => queryClient.invalidateQueries(router.pathFilter())),
        );
      },
      onError: toastError,
    }),
  );

  const setHidden = useMutation(
    trpc.categories.setHidden.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries(trpc.categories.pathFilter()),
      onError: toastError,
    }),
  );

  const openForm = (category: Category | null, parentId: string | null) => {
    setEditing(category);
    setPresetParentId(parentId);
    setFormOpen(true);
  };

  const rows = categories.data ?? [];
  // the color each top-level category has in the reports
  const colorOrder = categoryColorOrder(rows);
  const colorOf = (id: string) => {
    const index = colorOrder.indexOf(id);

    return seriesColor(id, index < 0 ? undefined : (index % SERIES_SLOTS) + 1);
  };

  const matches = (category: Category) =>
    view === "all" ||
    (view === "expense" ? category.isExpense : category.isIncome);

  // a card per top-level category with its subcategories; one whose parent
  // the user can't read stands on its own
  const known = new Set(rows.map((row) => row.id));
  const childrenOf = new Map<string, Category[]>();

  for (const row of rows) {
    if (row.parentId && known.has(row.parentId)) {
      childrenOf.set(row.parentId, [
        ...(childrenOf.get(row.parentId) ?? []),
        row,
      ]);
    }
  }

  const cards = rows
    .filter((row) => !row.parentId || !known.has(row.parentId))
    .map((top) => ({
      top,
      children: (childrenOf.get(top.id) ?? []).filter(matches),
    }))
    .filter((card) => matches(card.top) || card.children.length > 0);

  // the transaction filter matches exact ids, so a parent brings its children
  const leafIdsOf = (id: string) => [
    id,
    ...(childrenOf.get(id) ?? []).map((child) => child.id),
  ];

  // this month's sums of the tab's kinds, per category and currency; a
  // parent counts its subcategories
  const sums = useMemo(() => {
    const map = new Map<string, Map<string, Sum>>();
    const add = (id: string, code: string, sign: string, amount: number) => {
      const byCode = map.get(id) ?? new Map<string, Sum>();
      const sum = byCode.get(code) ?? { code, sign, amount: 0 };
      sum.amount += amount;
      byCode.set(code, sum);
      map.set(id, byCode);
    };

    for (const row of report.data?.rows ?? []) {
      const counted =
        view === "all"
          ? row.kind === "expense" || row.kind === "income"
          : row.kind === view;

      if (!counted || !row.categoryId) {
        continue;
      }

      add(row.categoryId, row.currencyCode, row.currencySign, row.amount);

      if (row.parentId) {
        add(row.parentId, row.currencyCode, row.currencySign, row.amount);
      }
    }

    return map;
  }, [report.data, view]);

  /** The month's amounts, primary currency first, like a transaction's */
  const amountOf = (id: string, emphasis: string): ReactNode => {
    const list = [...(sums.get(id)?.values() ?? [])]
      .filter((sum) => sum.amount !== 0)
      .sort(
        (a, b) =>
          Number(b.code === primaryCode) - Number(a.code === primaryCode) ||
          a.code.localeCompare(b.code),
      );

    // an empty slot keeps the menus and meta in one column
    return list.length === 0 ? (
      <span />
    ) : (
      list.map((sum, index) => (
        <Money
          key={sum.code}
          amount={sum.amount}
          sign={sum.sign}
          showPlus
          colored
          className={index === 0 ? emphasis : "text-muted-foreground text-xs"}
        />
      ))
    );
  };

  // every row opens the same way; one shared without edit rights says why
  // it can't, instead of doing something else
  const openCategory = (category: Category) => {
    if (category.canWrite) {
      openForm(category, null);
    } else {
      toast.info(t("readOnly", { name: category.ownerName }));
    }
  };

  const row = (category: Category, top: boolean) => {
    const meta = [
      top && category.childCount > 0
        ? t("subcategories", { count: category.childCount })
        : null,
      view === "all" && category.isExpense ? t("isExpense") : null,
      view === "all" && category.isIncome ? t("isIncome") : null,
      category.isOwn ? null : tc("owner", { name: category.ownerName }),
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <LedgerRow
        key={category.id}
        // a category on its own whose parent is unreadable keeps its full name
        title={top && category.parentId ? category.displayName : category.name}
        titleClassName={cn(top && "font-semibold")}
        className={cn(!top && CHILD_INDENT, category.isHidden && "opacity-60")}
        leading={
          top ? (
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: colorOf(category.parentId ?? category.id) }}
            />
          ) : null
        }
        badges={
          <>
            {category.isHidden ? (
              <Badge variant="outline" className="shrink-0">
                <EyeOffIcon />
                {t("hidden")}
              </Badge>
            ) : null}
            {category.isShared ? (
              <Badge variant="secondary" className="shrink-0">
                <UsersIcon />
                {tc("shared")}
              </Badge>
            ) : null}
          </>
        }
        meta={meta || null}
        amount={amountOf(
          category.id,
          top ? "text-sm font-semibold" : "text-sm font-medium",
        )}
        onOpen={() => openCategory(category)}
        actions={
          <RowMenu>
            <DropdownMenuItem asChild>
              <Link
                href={filteredHref("/transactions", {
                  categories: leafIdsOf(category.id),
                })}
              >
                <ListIcon />
                {t("showTransactions")}
              </Link>
            </DropdownMenuItem>
            {category.canWrite ? (
              <>
                <DropdownMenuItem onSelect={() => openForm(category, null)}>
                  <PencilIcon />
                  {tc("edit")}
                </DropdownMenuItem>
                {category.parentId === null ? (
                  <DropdownMenuItem
                    onSelect={() => openForm(null, category.id)}
                  >
                    <FolderPlusIcon />
                    {t("addChild")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => setSharing(category)}>
                  <Share2Icon />
                  {tc("share")}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem
              onSelect={() =>
                setHidden.mutate({
                  id: category.id,
                  hidden: !category.isHidden,
                })
              }
            >
              {category.isHidden ? <EyeIcon /> : <EyeOffIcon />}
              {category.isHidden ? t("show") : t("hide")}
            </DropdownMenuItem>
            {category.canWrite ? (
              <>
                <DropdownMenuSeparator />
                {category.childCount === 0 ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setTargetId("");
                      setReplacing(category);
                    }}
                  >
                    <ReplaceIcon />
                    {t("replace")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleting(category)}
                >
                  <Trash2Icon />
                  {tc("delete")}
                </DropdownMenuItem>
              </>
            ) : null}
          </RowMenu>
        }
      />
    );
  };

  // a target shares a kind with the source; the server checks the rows
  const replaceTargets = replacing
    ? categoryOptions(
        rows.filter(
          (row) =>
            row.canWrite &&
            row.id !== replacing.id &&
            ((replacing.isExpense && row.isExpense) ||
              (replacing.isIncome && row.isIncome)),
        ),
        locale,
      )
    : [];

  return (
    <LedgerLayout
      title={t("title")}
      actions={
        <Button size="sm" onClick={() => openForm(null, null)}>
          <PlusIcon />
          <span className="max-sm:sr-only">{t("add")}</span>
        </Button>
      }
      sidebarTitle={t("monthTitle")}
      sidebarIcon={ChartPieIcon}
      sidebar={
        <CategoriesSidebar
          rows={report.data?.rows ?? []}
          pending={report.isPending}
          kind={view === "income" ? "income" : "expense"}
          period={month}
          primaryCode={primaryCode}
          colorOf={colorOf}
          leafIdsOf={leafIdsOf}
        />
      }
    >
      {categories.isPending || !ready ? (
        <LoadingRegion className="flex flex-col gap-4">
          <TabsSkeleton />
          <CategoryListSkeleton />
        </LoadingRegion>
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderTreeIcon />
            </EmptyMedia>
            <EmptyTitle>{t("empty")}</EmptyTitle>
            <EmptyDescription>{t("emptyHint")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => openForm(null, null)}>
              <PlusIcon />
              {t("add")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <Tabs
            value={view}
            onValueChange={(value) =>
              setView(Schema.decodeUnknownSync(viewSchema)(value))
            }
          >
            <TabsList aria-label={t("view")}>
              <TabsTrigger value="all">{t("viewAll")}</TabsTrigger>
              <TabsTrigger value="expense">{t("viewExpense")}</TabsTrigger>
              <TabsTrigger value="income">{t("viewIncome")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {cards.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("emptyView")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {cards.map(({ top, children }) => (
                <LedgerCard key={top.id}>
                  {row(top, true)}
                  {children.map((child) => row(child, false))}
                </LedgerCard>
              ))}
            </div>
          )}
          {rows.some((category) => category.isHidden) ? (
            <p className="text-muted-foreground text-sm">{t("hiddenHint")}</p>
          ) : null}
        </>
      )}

      <CategoryFormDialog
        open={formOpen}
        category={editing}
        presetParentId={presetParentId}
        categories={rows}
        onOpenChange={setFormOpen}
      />
      <ShareDialog
        entity="category"
        target={sharing ? { id: sharing.id, name: sharing.displayName } : null}
        onOpenChange={(open) => !open && setSharing(null)}
      />
      <ResponsiveDialog
        open={replacing !== null}
        onOpenChange={(open) => !open && setReplacing(null)}
        title={t("replaceTitle", { name: replacing?.displayName ?? "" })}
        description={t("replaceDescription", {
          name: replacing?.displayName ?? "",
        })}
        footer={
          <>
            <Button variant="outline" onClick={() => setReplacing(null)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={replace.isPending || !targetId}
              onClick={() =>
                replacing &&
                replace.mutate({ sourceId: replacing.id, targetId })
              }
            >
              {replace.isPending ? <Spinner /> : null}
              {t("replaceSubmit")}
            </Button>
          </>
        }
      >
        <Field>
          <FieldLabel htmlFor="replace-target">{t("replaceTarget")}</FieldLabel>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger id="replace-target" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {replaceTargets.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </ResponsiveDialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle", { name: deleting?.displayName ?? "" })}
        description={t("deleteDescription")}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </LedgerLayout>
  );
}
