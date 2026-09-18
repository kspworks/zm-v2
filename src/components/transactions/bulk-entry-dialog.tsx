"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DatePicker } from "~/components/app/date-picker";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import { CategorySelect } from "~/components/transactions/category-select";
import { useInvalidateMoney } from "~/components/transactions/transaction-form";
import { useToday } from "~/components/transactions/transaction-groups";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
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
import { parseAmountInput } from "~/lib/money";
import { cn } from "~/lib/utils";
import { useTRPC } from "~/trpc/react";

type Row = {
  key: number;
  kind: "expense" | "income";
  amount: string;
  categoryId: string | null;
  comment: string;
};

let nextKey = 1;

const emptyRow = (kind: Row["kind"] = "expense"): Row => ({
  key: nextKey++,
  kind,
  amount: "",
  categoryId: null,
  comment: "",
});

/** Several rows sharing a date and an account, saved in one call */
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
  const [date, setDate] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(), emptyRow()]);
  const [showErrors, setShowErrors] = useState(false);
  const selectedAccount = accountId || accountOptions[0]?.id || "";

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
      .filter((row) => !((parseAmountInput(row.amount) ?? 0) > 0))
      .map((row) => row.key),
  );

  const save = useMutation(
    trpc.transactions.bulkCreate.mutationOptions({
      onSuccess: async (result) => {
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

    if (filled.length === 0 || invalidKeys.size > 0 || !selectedAccount) {
      return;
    }

    save.mutate({
      items: filled.map((row) => ({
        kind: row.kind,
        date: date ?? today,
        amount: parseAmountInput(row.amount) ?? 0,
        accountId: selectedAccount,
        categoryId: row.categoryId,
        comment: row.comment.trim() || null,
      })),
    });
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      className="sm:max-w-3xl"
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
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="bulk-date">{t("date")}</FieldLabel>
            <DatePicker
              id="bulk-date"
              value={date ?? today}
              onChange={(value) => setDate(value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="bulk-account">{t("account")}</FieldLabel>
            <Select value={selectedAccount} onValueChange={setAccountId}>
              <SelectTrigger id="bulk-account" className="w-full">
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
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div
              key={row.key}
              className="grid grid-cols-[auto_1fr_auto] gap-2 rounded-lg border p-2 sm:grid-cols-[auto_8rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:border-0 sm:p-0"
            >
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
                  <PlusIcon className="text-emerald-600 dark:text-emerald-400" />
                )}
              </Button>
              <Input
                aria-label={tf("amount")}
                placeholder={tf("amount")}
                inputMode="decimal"
                autoComplete="off"
                autoFocus={index === 0}
                className={cn("tabular-nums")}
                aria-invalid={showErrors && invalidKeys.has(row.key)}
                value={row.amount}
                onChange={(event) =>
                  update(row.key, { amount: event.target.value })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="sm:order-last"
                aria-label={t("removeRow")}
                disabled={rows.length === 1}
                onClick={() =>
                  setRows((current) => current.filter((r) => r.key !== row.key))
                }
              >
                <Trash2Icon />
              </Button>
              <div className="col-span-3 sm:col-span-1">
                <CategorySelect
                  options={options[row.kind]}
                  value={row.categoryId}
                  onChange={(categoryId) => update(row.key, { categoryId })}
                />
              </div>
              <Input
                className="col-span-3 sm:col-span-1"
                aria-label={tf("comment")}
                placeholder={tf("comment")}
                maxLength={500}
                value={row.comment}
                onChange={(event) =>
                  update(row.key, { comment: event.target.value })
                }
              />
            </div>
          ))}
          <button type="submit" hidden />
        </div>

        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() =>
            setRows((current) => [...current, emptyRow(current.at(-1)?.kind)])
          }
        >
          <PlusIcon />
          {t("addRow")}
        </Button>
      </form>
    </ResponsiveDialog>
  );
}
