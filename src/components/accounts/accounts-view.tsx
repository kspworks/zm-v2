"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BanknoteIcon,
  CreditCardIcon,
  EllipsisVerticalIcon,
  HandCoinsIcon,
  LandmarkIcon,
  type LucideIcon,
  PencilIcon,
  PiggyBankIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  Share2Icon,
  Trash2Icon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  AccountFormDialog,
  type EditableAccount,
} from "~/components/accounts/account-form-dialog";
import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { Money } from "~/components/app/money";
import { PageHeader } from "~/components/app/page-header";
import { ShareDialog } from "~/components/app/share-dialog";
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
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item";
import { Skeleton } from "~/components/ui/skeleton";
import { useToastError } from "~/hooks/use-toast-error";
import { cn } from "~/lib/utils";
import { useTRPC } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/types";

type Account = RouterOutputs["accounts"]["list"][number];

const TYPE_ICONS: Record<Account["type"], LucideIcon> = {
  cash: BanknoteIcon,
  card: CreditCardIcon,
  account: LandmarkIcon,
  credit: HandCoinsIcon,
  deposit: PiggyBankIcon,
  debt: WalletIcon,
};

export function AccountsView() {
  const t = useTranslations("accounts");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const accounts = useQuery(trpc.accounts.list.queryOptions());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EditableAccount | null>(null);
  const [sharing, setSharing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.accounts.pathFilter());

  const setActive = useMutation(
    trpc.accounts.setActive.mutationOptions({
      onSuccess: invalidate,
      onError: toastError,
    }),
  );
  const remove = useMutation(
    trpc.accounts.delete.mutationOptions({
      onSuccess: async () => {
        toast.success(tc("deleted"));
        setDeleting(null);
        await invalidate();
      },
      onError: toastError,
    }),
  );

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <Button size="sm" onClick={openCreate}>
            <PlusIcon />
            <span className="max-sm:sr-only">{t("add")}</span>
          </Button>
        }
      />

      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        {accounts.isPending ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : accounts.data?.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WalletIcon />
              </EmptyMedia>
              <EmptyTitle>{t("empty")}</EmptyTitle>
              <EmptyDescription>{t("emptyHint")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={openCreate}>
                <PlusIcon />
                {t("add")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <ItemGroup className="gap-2">
            {accounts.data?.map((account) => {
              const Icon = TYPE_ICONS[account.type];

              return (
                <Item
                  key={account.id}
                  variant="outline"
                  className={cn(!account.isActive && "opacity-60")}
                >
                  <ItemMedia variant="icon">
                    <Icon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full flex-wrap">
                      <span className="truncate">{account.name}</span>
                      {!account.isActive ? (
                        <Badge variant="outline">{tc("inactive")}</Badge>
                      ) : null}
                      {account.isShared ? (
                        <Badge variant="secondary">
                          <UsersIcon />
                          {tc("shared")}
                        </Badge>
                      ) : null}
                    </ItemTitle>
                    <ItemDescription className="truncate">
                      {t(`types.${account.type}`)} · {account.currencyCode} ·{" "}
                      {t("usage", { count: account.usage })}
                      {account.isOwn
                        ? null
                        : ` · ${tc("owner", { name: account.ownerName })}`}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Money
                      amount={account.balance}
                      sign={account.currencySign}
                      className={cn(
                        "font-medium",
                        account.balance < 0 && "text-destructive",
                      )}
                    />
                    {account.canWrite ? (
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
                            onSelect={() => {
                              setEditing(account);
                              setFormOpen(true);
                            }}
                          >
                            <PencilIcon />
                            {tc("edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setSharing(account)}
                          >
                            <Share2Icon />
                            {tc("share")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              setActive.mutate({
                                id: account.id,
                                isActive: !account.isActive,
                              })
                            }
                          >
                            {account.isActive ? (
                              <PowerOffIcon />
                            ) : (
                              <PowerIcon />
                            )}
                            {account.isActive ? t("deactivate") : t("activate")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setDeleting(account)}
                          >
                            <Trash2Icon />
                            {tc("delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        )}
      </div>

      <AccountFormDialog
        open={formOpen}
        account={editing}
        onOpenChange={setFormOpen}
      />
      <ShareDialog
        entity="account"
        target={sharing}
        onOpenChange={(open) => !open && setSharing(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteTitle", { name: deleting?.name ?? "" })}
        description={t("deleteDescription")}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </>
  );
}
