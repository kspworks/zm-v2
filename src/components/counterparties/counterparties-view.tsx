"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EllipsisVerticalIcon,
  HandshakeIcon,
  MergeIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { PageHeader } from "~/components/app/page-header";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import { ItemListSkeleton, LoadingRegion } from "~/components/app/skeletons";
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
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
import { formatMoney } from "~/lib/money";
import { filteredHref } from "~/lib/transaction-links";
import { useTRPC } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/types";

type Counterparty = RouterOutputs["counterparties"]["list"][number];

export function DebtBalance({ sum, sign }: { sum: number; sign: string }) {
  const t = useTranslations("counterparties");
  const amount = formatMoney(Math.abs(sum), sign);

  return sum > 0 ? (
    <Badge variant="outline" className="text-positive border-emerald-600/40">
      {t("oweMe", { amount })}
    </Badge>
  ) : (
    <Badge variant="outline" className="border-destructive/40 text-destructive">
      {t("iOwe", { amount })}
    </Badge>
  );
}

export function CounterpartiesView() {
  const t = useTranslations("counterparties");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const list = useQuery(trpc.counterparties.list.queryOptions());

  const [renaming, setRenaming] = useState<Counterparty | null>(null);
  const [name, setName] = useState("");
  const [merging, setMerging] = useState<Counterparty | null>(null);
  const [targetId, setTargetId] = useState("");
  const [deleting, setDeleting] = useState<Counterparty | null>(null);

  useEffect(() => {
    setName(renaming?.name ?? "");
  }, [renaming]);

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.counterparties.pathFilter());

  const rename = useMutation(
    trpc.counterparties.rename.mutationOptions({
      onSuccess: async () => {
        setRenaming(null);
        await invalidate();
      },
      onError: toastError,
    }),
  );
  const merge = useMutation(
    trpc.counterparties.merge.mutationOptions({
      onSuccess: async () => {
        setMerging(null);
        await invalidate();
      },
      onError: toastError,
    }),
  );
  const remove = useMutation(
    trpc.counterparties.delete.mutationOptions({
      onSuccess: async () => {
        toast.success(tc("deleted"));
        setDeleting(null);
        await invalidate();
      },
      onError: toastError,
    }),
  );

  const rows = list.data ?? [];

  return (
    <>
      <PageHeader title={t("title")} />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
        {/* shown while loading too, so the list does not move when it lands */}
        {list.isPending || rows.length > 0 ? (
          <p className="text-muted-foreground text-sm">{t("hint")}</p>
        ) : null}
        {list.isPending ? (
          <LoadingRegion>
            <ItemListSkeleton />
          </LoadingRegion>
        ) : rows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HandshakeIcon />
              </EmptyMedia>
              <EmptyTitle>{t("empty")}</EmptyTitle>
              <EmptyDescription>{t("emptyHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-2">
            {rows.map((row) => (
              <Item
                key={row.id}
                variant="outline"
                size="sm"
                className="hover:bg-accent/50 relative transition-colors"
              >
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full">
                    <Link
                      href={filteredHref("/transactions", {
                        counterparties: [row.id],
                      })}
                      className="focus-visible:after:ring-ring truncate outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2"
                    >
                      {row.name}
                    </Link>
                  </ItemTitle>
                  <ItemDescription>
                    {t("usage", { count: row.usage })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="relative z-10 flex-wrap justify-end">
                  {row.balances.map((balance) => (
                    <DebtBalance
                      key={balance.currencyId}
                      sum={balance.sum}
                      sign={balance.currencySign}
                    />
                  ))}
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
                      <DropdownMenuItem onSelect={() => setRenaming(row)}>
                        <PencilIcon />
                        {t("rename")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={rows.length < 2}
                        onSelect={() => {
                          setTargetId("");
                          setMerging(row);
                        }}
                      >
                        <MergeIcon />
                        {t("merge")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={row.usage > 0}
                        onSelect={() => setDeleting(row)}
                      >
                        <Trash2Icon />
                        {tc("delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </div>

      <ResponsiveDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title={t("renameTitle")}
        footer={
          <>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              {tc("cancel")}
            </Button>
            <Button
              type="submit"
              form="rename-form"
              disabled={rename.isPending || !name.trim()}
            >
              {rename.isPending ? <Spinner /> : null}
              {tc("save")}
            </Button>
          </>
        }
      >
        <form
          id="rename-form"
          onSubmit={(event) => {
            event.preventDefault();

            if (renaming && name.trim()) {
              rename.mutate({ id: renaming.id, name });
            }
          }}
        >
          <Field>
            <FieldLabel htmlFor="counterparty-name">{t("name")}</FieldLabel>
            <Input
              id="counterparty-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </form>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={merging !== null}
        onOpenChange={(open) => !open && setMerging(null)}
        title={t("mergeTitle", { name: merging?.name ?? "" })}
        description={t("mergeDescription", { name: merging?.name ?? "" })}
        footer={
          <>
            <Button variant="outline" onClick={() => setMerging(null)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={merge.isPending || !targetId}
              onClick={() =>
                merging && merge.mutate({ sourceId: merging.id, targetId })
              }
            >
              {merge.isPending ? <Spinner /> : null}
              {t("mergeSubmit")}
            </Button>
          </>
        }
      >
        <Field>
          <FieldLabel htmlFor="merge-target">{t("mergeTarget")}</FieldLabel>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger id="merge-target" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rows
                .filter((row) => row.id !== merging?.id)
                .map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
      </ResponsiveDialog>

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
