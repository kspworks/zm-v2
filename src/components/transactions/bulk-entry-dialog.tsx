"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AmountInput } from "~/components/app/amount-input";
import { DatePicker } from "~/components/app/date-picker";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import { CategorySelect } from "~/components/transactions/category-select";
import { useInvalidateMoney } from "~/components/transactions/transaction-form";
import { useToday } from "~/components/transactions/transaction-groups";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { useIdempotencyKey } from "~/hooks/use-idempotency-key";
import { useToastError } from "~/hooks/use-toast-error";
import { categoryOptions } from "~/lib/category-options";
import { evaluateAmount } from "~/lib/money";
import { useTRPC } from "~/trpc/react";

type Row = {
  key: number;
  kind: "expense" | "income";
  amount: string;
  categoryId: string | null;
  /** `null` is today */
  date: string | null;
  /** `""` is the default account */
  accountId: string;
  comment: string;
};

let nextKey = 1;

/** A new row repeats the last one's type, date and account */
const emptyRow = (after?: Row): Row => ({
  key: nextKey++,
  kind: after?.kind ?? "expense",
  amount: "",
  categoryId: null,
  date: after?.date ?? null,
  accountId: after?.accountId ?? "",
  comment: "",
});

/** Several rows, each with its own date and account, saved in one call */
export function BulkEntryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("bulk");
  const tf = useTranslations("form");
  const tc = useTranslations("common");
  const tt = useTranslations("transactions");
  const locale = useLocale();
  const trpc = useTRPC();
  const today = useToday();
  const toastError = useToastError();
  const invalidate = useInvalidateMoney();
  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const categories = useQuery(trpc.categories.list.queryOptions());

  const accountOptions = (accounts.data ?? []).filter(
    (a) => a.canWrite && a.isActive,
  );
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(), emptyRow()]);
  const [showErrors, setShowErrors] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focusAmount = useCallback(
    (index: number) =>
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelectorAll<HTMLInputElement>("[data-bulk-amount]")
          [index]?.focus(),
      ),
    [],
  );

  // start on the first amount, not the date: that is what changes most
  useEffect(() => {
    if (open) {
      focusAmount(0);
    }
  }, [open, focusAmount]);

  /** Enter in an amount goes to the next row's, adding one at the end */
  const nextRow = (index: number) => {
    if (index === rows.length - 1) {
      setRows((current) => [...current, emptyRow(current.at(-1))]);
    }

    focusAmount(index + 1);
  };
  const accountOf = (row: Row) => row.accountId || accountOptions[0]?.id || "";

  const options = useMemo(
    () => ({
      expense: categoryOptions(categories.data ?? [], locale, "expense"),
      income: categoryOptions(categories.data ?? [], locale, "income"),
    }),
    [categories.data, locale],
  );

  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  const filled = rows.filter((row) => row.amount.trim() !== "");
  const invalidKeys = new Set(
    filled
      .filter((row) => !((evaluateAmount(row.amount) ?? 0) > 0))
      .map((row) => row.key),
  );

  // kept while the rows are (closing keeps them as a draft), renewed on save
  const idempotency = useIdempotencyKey();
  const save = useMutation(
    trpc.transactions.bulkCreate.mutationOptions({
      onSuccess: async (result) => {
        idempotency.renew();
        toast.success(t("saved", { count: result.created }));

        for (const balance of result.balances) {
          if (balance.balance < 0) {
            toast.warning(tt("toast.negative", { name: balance.name }));
          }
        }

        await invalidate();
        setRows([emptyRow(), emptyRow()]);
        setShowErrors(false);
        onOpenChange(false);
      },
      onError: toastError,
    }),
  );

  const submit = () => {
    setShowErrors(true);

    if (
      filled.length === 0 ||
      invalidKeys.size > 0 ||
      filled.some((row) => !accountOf(row))
    ) {
      return;
    }

    save.mutate({
      items: filled.map((row) => ({
        kind: row.kind,
        date: row.date ?? today,
        amount: evaluateAmount(row.amount) ?? 0,
        accountId: accountOf(row),
        categoryId: row.categoryId,
        comment: row.comment.trim() || null,
      })),
      idempotencyKey: idempotency.key,
    });
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      className="sm:max-w-5xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            disabled={save.isPending || filled.length === 0}
            onClick={submit}
          >
            {save.isPending ? <Spinner /> : null}
            {t("submit")}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }}
      >
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div
              key={row.key}
              className="grid grid-cols-[auto_1fr_auto] gap-2 rounded-lg border p-2 sm:grid-cols-[9rem_auto_7rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:border-0 sm:p-0"
            >
              <DatePicker
                className="col-span-3 max-sm:order-1 sm:col-span-1"
                value={row.date ?? today}
                onChange={(date) => update(row.key, { date })}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={tf(`kinds.${row.kind}`)}
                title={tf(`kinds.${row.kind}`)}
                onClick={() =>
                  update(row.key, {
                    kind: row.kind === "expense" ? "income" : "expense",
                    categoryId: null,
                  })
                }
              >
                {row.kind === "expense" ? (
                  <MinusIcon className="text-destructive" />
                ) : (
                  <PlusIcon className="text-positive" />
                )}
              </Button>
              <AmountInput
                aria-label={tf("amount")}
                placeholder={tf("amount")}
                data-bulk-amount
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.ctrlKey &&
                    !event.metaKey
                  ) {
                    event.preventDefault();
                    nextRow(index);
                  }
                }}
                aria-invalid={showErrors && invalidKeys.has(row.key)}
                value={row.amount}
                onChange={(amount) => update(row.key, { amount })}
              />
              <div className="col-span-3 max-sm:order-1 sm:col-span-1">
                <CategorySelect
                  options={options[row.kind]}
                  value={row.categoryId}
                  onChange={(categoryId) => update(row.key, { categoryId })}
                />
              </div>
              <Select
                value={accountOf(row)}
                onValueChange={(accountId) => update(row.key, { accountId })}
              >
                <SelectTrigger
                  aria-label={t("account")}
                  className="col-span-3 w-full max-sm:order-1 sm:col-span-1"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name} · {option.currencyCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label={tf("comment")}
                placeholder={tf("comment")}
                autoComplete="off"
                className="col-span-3 max-sm:order-1 sm:col-span-1"
                value={row.comment}
                onChange={(event) =>
                  update(row.key, { comment: event.target.value })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("removeRow")}
                disabled={rows.length === 1}
                onClick={() =>
                  setRows((current) => current.filter((r) => r.key !== row.key))
                }
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <button type="submit" hidden />
        </div>

        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() =>
            setRows((current) => [...current, emptyRow(current.at(-1))])
          }
        >
          <PlusIcon />
          {t("addRow")}
        </Button>
      </form>
    </ResponsiveDialog>
  );
}
