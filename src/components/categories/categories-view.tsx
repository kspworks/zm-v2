"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CornerDownRightIcon,
  EllipsisVerticalIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  PencilIcon,
  PlusIcon,
  Share2Icon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { PageHeader } from "~/components/app/page-header";
import { ShareDialog } from "~/components/app/share-dialog";
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "~/components/ui/item";
import { Skeleton } from "~/components/ui/skeleton";
import { useToastError } from "~/hooks/use-toast-error";
import { cn } from "~/lib/utils";
import { useTRPC } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/types";

type Category = RouterOutputs["categories"]["list"][number];

export function CategoriesView() {
  const t = useTranslations("categories");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const categories = useQuery(trpc.categories.list.queryOptions());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [presetParentId, setPresetParentId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

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

  const openForm = (category: Category | null, parentId: string | null) => {
    setEditing(category);
    setPresetParentId(parentId);
    setFormOpen(true);
  };

  const rows = categories.data ?? [];

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
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
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
          <ItemGroup className="gap-1.5">
            {rows.map((category) => (
              <Item
                key={category.id}
                variant="outline"
                size="sm"
                className={cn(category.parentId && "ml-6 w-auto sm:ml-8")}
              >
                <ItemContent className="min-w-40">
                  <ItemTitle className="w-full flex-wrap">
                    <span className="flex min-w-0 items-center gap-2">
                      {category.parentId ? (
                        <CornerDownRightIcon className="size-3.5 text-muted-foreground" />
                      ) : null}
                      <span className="truncate">{category.name}</span>
                    </span>
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
                      className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
                    >
                      {t("isIncome")}
                    </Badge>
                  ) : null}
                  {category.canWrite ? (
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
                        <DropdownMenuItem onSelect={() => setSharing(category)}>
                          <Share2Icon />
                          {tc("share")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleting(category)}
                        >
                          <Trash2Icon />
                          {tc("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
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
