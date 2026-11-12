"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CornerDownRightIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  EyeOffIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  PencilIcon,
  PlusIcon,
  ReplaceIcon,
  Share2Icon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { AfterHydration } from "~/components/app/after-hydration";
import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { PageHeader } from "~/components/app/page-header";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import { CategoriesPageSkeleton } from "~/components/app/route-skeletons";
import { ShareDialog } from "~/components/app/share-dialog";
import {
  CategoryListSkeleton,
  LoadingRegion,
} from "~/components/app/skeletons";
import { CategoryFormDialog } from "~/components/categories/category-form-dialog";
import { Badge } from "~/components/ui/badge";
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
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "~/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { useToastError } from "~/hooks/use-toast-error";
import { categoryOptions } from "~/lib/category-options";
import { categoryColorOrder, SERIES_SLOTS, seriesColor } from "~/lib/report";
import { cn } from "~/lib/utils";
import { useTRPC } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/types";

type Category = RouterOutputs["categories"]["list"][number];

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
    <>
      <PageHeader
        title={t("title")}
        actions={
          <Button size="sm" onClick={() => openForm(null, null)}>
            <PlusIcon />
            <span className="max-sm:sr-only">{t("add")}</span>
          </Button>
        }
      />

      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        {categories.isPending ? (
          <LoadingRegion>
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
          <ItemGroup className="bg-card gap-0 divide-y overflow-hidden rounded-lg border has-data-[size=sm]:gap-0">
            {rows.map((category) => (
              <Item
                key={category.id}
                size="sm"
                className={cn(
                  "rounded-none border-x-0 border-t-0 py-1.5",
                  category.parentId && "pl-9 sm:pl-11",
                  category.isHidden && "opacity-60",
                )}
              >
                <ItemContent className="min-w-40">
                  <ItemTitle className="w-full flex-wrap">
                    <span className="flex min-w-0 items-center gap-2">
                      {category.parentId ? (
                        <CornerDownRightIcon className="text-muted-foreground size-3.5" />
                      ) : (
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-sm"
                          style={{ background: colorOf(category.id) }}
                        />
                      )}
                      <span className="truncate">{category.name}</span>
                    </span>
                    {category.isHidden ? (
                      <Badge variant="outline">
                        <EyeOffIcon />
                        {t("hidden")}
                      </Badge>
                    ) : null}
                    {category.isShared ? (
                      <Badge variant="secondary">
                        <UsersIcon />
                        {tc("shared")}
                      </Badge>
                    ) : null}
                  </ItemTitle>
                  {category.isOwn ? null : (
                    <ItemDescription>
                      {tc("owner", { name: category.ownerName })}
                    </ItemDescription>
                  )}
                </ItemContent>
                <ItemActions className="ml-auto">
                  {category.isExpense ? (
                    <Badge variant="outline">{t("isExpense")}</Badge>
                  ) : null}
                  {category.isIncome ? (
                    <Badge
                      variant="outline"
                      className="text-positive border-emerald-600/40"
                    >
                      {t("isIncome")}
                    </Badge>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={tc("actions")}
                      >
                        <EllipsisVerticalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {category.canWrite ? (
                        <>
                          <DropdownMenuItem
                            onSelect={() => openForm(category, null)}
                          >
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
                          <DropdownMenuItem
                            onSelect={() => setSharing(category)}
                          >
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
        {rows.some((row) => row.isHidden) ? (
          <p className="text-muted-foreground mt-3 text-sm">
            {t("hiddenHint")}
          </p>
        ) : null}
      </div>

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
    </>
  );
}
