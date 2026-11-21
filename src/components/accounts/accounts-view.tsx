"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BanknoteIcon,
  CreditCardIcon,
  HandCoinsIcon,
  LandmarkIcon,
  ListIcon,
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
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  AccountFormDialog,
  type EditableAccount,
} from "~/components/accounts/account-form-dialog";
import { AfterHydration } from "~/components/app/after-hydration";
import { BalancesSidebar } from "~/components/app/balances-sidebar";
import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { LedgerLayout } from "~/components/app/ledger-layout";
import {
  LedgerGroup,
  LedgerGroups,
  LedgerHeading,
  LedgerRow,
} from "~/components/app/ledger-list";
import { Money } from "~/components/app/money";
import { AccountsPageSkeleton } from "~/components/app/route-skeletons";
import { ShareDialog } from "~/components/app/share-dialog";
import { AccountListSkeleton, LoadingRegion } from "~/components/app/skeletons";
import { RowMenu } from "~/components/transactions/row-menu";
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
import { usePrimaryCurrency } from "~/hooks/use-primary-currency";
import { useToastError } from "~/hooks/use-toast-error";
import { filteredHref } from "~/lib/transaction-links";
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

type CurrencyGroup = {
  currencyId: string;
  code: string;
  sign: string;
  total: number;
  accounts: Account[];
};

/**
 * Active accounts by currency, the primary one first, so each group's total
 * is a sum that means something. Within a group the server's order (most
 * used first) holds.
 */
const byCurrency = (
  accounts: Account[],
  primaryId: string | null,
): CurrencyGroup[] => {
  const groups = new Map<string, CurrencyGroup>();

  for (const account of accounts) {
    const group = groups.get(account.currencyId) ?? {
      currencyId: account.currencyId,
      code: account.currencyCode,
      sign: account.currencySign,
      total: 0,
      accounts: [],
    };
    group.total += account.balance;
    group.accounts.push(account);
    groups.set(account.currencyId, group);
  }

  return [...groups.values()].sort(
    (a, b) =>
      Number(b.currencyId === primaryId) - Number(a.currencyId === primaryId) ||
      a.code.localeCompare(b.code),
  );
};

export function AccountsView() {
  return (
    <AfterHydration fallback={<AccountsPageSkeleton />}>
      <Accounts />
    </AfterHydration>
  );
}

function Accounts() {
  const t = useTranslations("accounts");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const primary = usePrimaryCurrency();

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

  // every row opens the same way; one shared without edit rights says why
  // it can't, instead of doing something else
  const openAccount = (account: Account) => {
    if (account.canWrite) {
      setEditing(account);
      setFormOpen(true);
    } else {
      toast.info(t("readOnly", { name: account.ownerName }));
    }
  };

  const all = accounts.data ?? [];
  const groups = byCurrency(
    all.filter((account) => account.isActive),
    primary.currencyId,
  );
  const inactive = all.filter((account) => !account.isActive);

  const row = (account: Account) => {
    const Icon = TYPE_ICONS[account.type];
    const meta = [
      t(`types.${account.type}`),
      // the inactive group mixes currencies
      account.isActive ? null : account.currencyCode,
      t("usage", { count: account.usage }),
      account.isOwn ? null : tc("owner", { name: account.ownerName }),
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <LedgerRow
        key={account.id}
        title={account.name}
        titleClassName={cn(!account.isActive && "text-muted-foreground")}
        leading={<Icon className="text-muted-foreground size-4" />}
        badges={
          account.isShared ? (
            <Badge variant="secondary" className="shrink-0">
              <UsersIcon />
              {tc("shared")}
            </Badge>
          ) : null
        }
        meta={meta}
        amount={
          <Money
            amount={account.balance}
            sign={account.currencySign}
            className={cn(
              "text-sm font-semibold",
              account.balance < 0 && "text-destructive",
              !account.isActive && "text-muted-foreground",
            )}
          />
        }
        onOpen={() => openAccount(account)}
        actions={
          <RowMenu>
            <DropdownMenuItem asChild>
              <Link
                href={filteredHref("/transactions", {
                  accounts: [account.id],
                })}
              >
                <ListIcon />
                {t("showTransactions")}
              </Link>
            </DropdownMenuItem>
            {account.canWrite ? (
              <>
                <DropdownMenuItem onSelect={() => openAccount(account)}>
                  <PencilIcon />
                  {tc("edit")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSharing(account)}>
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
                  {account.isActive ? <PowerOffIcon /> : <PowerIcon />}
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
              </>
            ) : null}
          </RowMenu>
        }
      />
    );
  };

  return (
    <LedgerLayout
      title={t("title")}
      actions={
        <Button size="sm" onClick={openCreate}>
          <PlusIcon />
          <span className="max-sm:sr-only">{t("add")}</span>
        </Button>
      }
      sidebar={<BalancesSidebar showAccounts={false} showNetWorth />}
    >
      {accounts.isPending ? (
        <LoadingRegion>
          <AccountListSkeleton />
        </LoadingRegion>
      ) : all.length === 0 ? (
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
        <LedgerGroups>
          {groups.map((group) => (
            <LedgerGroup
              key={group.currencyId}
              heading={
                <LedgerHeading title={group.code}>
                  <Money
                    amount={group.total}
                    sign={group.sign}
                    className={cn(
                      "text-xs",
                      group.total < 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  />
                </LedgerHeading>
              }
            >
              {group.accounts.map(row)}
            </LedgerGroup>
          ))}
          {inactive.length > 0 ? (
            <LedgerGroup
              heading={
                <LedgerHeading title={t("inactiveGroup")}>
                  <span className="text-muted-foreground text-xs">
                    {t("count", { count: inactive.length })}
                  </span>
                </LedgerHeading>
              }
            >
              {inactive.map(row)}
            </LedgerGroup>
          ) : null}
        </LedgerGroups>
      )}

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
    </LedgerLayout>
  );
}
