"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Money } from "~/components/app/money";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import { CategorySelect } from "~/components/transactions/category-select";
import { useInvalidateMoney } from "~/components/transactions/transaction-form";
import { Button } from "~/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
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
import { type CategoryOption, categoryOptions } from "~/lib/category-options";
import { minorToInput, parseAmountInput } from "~/lib/money";
import { useTRPC } from "~/trpc/react";

type Kind = "income" | "expense";

type Row = {
  key: number;
  kind: Kind;
  amount: string;
  categoryId: string | null;
};

let nextKey = 1;

const KINDS: Kind[] = ["income", "expense"];

/**
 * Enter an account's actual balance and split the difference across income
 * and expense categories. Each group's top row takes whatever the other rows
 * leave, so income minus expenses always equals the difference.
 */
export function AdjustBalanceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("adjust");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const locale = useLocale();
  const trpc = useTRPC();
  const toastError = useToastError();
  const invalidate = useInvalidateMoney();
  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const categories = useQuery(trpc.categories.list.queryOptions());
  const options = (accounts.data ?? []).filter((a) => a.canWrite && a.isActive);

  const [accountId, setAccountId] = useState("");
  const [actual, setActual] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  // `undefined` is the seeded "Adjustment" category
  const [topCategory, setTopCategory] = useState<
    Record<Kind, string | null | undefined>
  >({ income: undefined, expense: undefined });
  const [showErrors, setShowErrors] = useState(false);

  const selectedId = accountId || options[0]?.id || "";
  const account = options.find((a) => a.id === selectedId);
  const actualMinor = parseAmountInput(actual, { allowSign: true });
  const invalid = actual.trim() !== "" && actualMinor === null;
  const difference =
    account && actualMinor !== null ? actualMinor - account.balance : null;

  const categoryOptionsByKind = useMemo(
    () => ({
      income: categoryOptions(categories.data ?? [], locale, "income"),
      expense: categoryOptions(categories.data ?? [], locale, "expense"),
    }),
    [categories.data, locale],
  );
  const adjustmentOf = (kind: Kind) =>
    (categories.data ?? []).find(
      (c) =>
        c.seedKey === "adjustment" &&
        c.canWrite &&
        (kind === "income" ? c.isIncome : c.isExpense),
    )?.id ?? null;
  const topCategoryOf = (kind: Kind) =>
    topCategory[kind] === undefined ? adjustmentOf(kind) : topCategory[kind];

  const amountOf = (row: Row) => parseAmountInput(row.amount) ?? 0;
  const invalidKeys = new Set(
    rows
      .filter((row) => row.amount.trim() !== "" && !(amountOf(row) > 0))
      .map((row) => row.key),
  );
  const extra = (kind: Kind) =>
    rows
      .filter((row) => row.kind === kind)
      .reduce((sum, row) => sum + amountOf(row), 0);

  const dominant: Kind = (difference ?? 0) < 0 ? "expense" : "income";
  const other: Kind = dominant === "income" ? "expense" : "income";
  const remainder = Math.abs(difference ?? 0) - extra(dominant) + extra(other);
  const top: Record<Kind, number> = {
    income: dominant === "income" ? remainder : 0,
    expense: dominant === "expense" ? remainder : 0,
  };
  const overflow = remainder < 0;

  const reset = () => {
    setActual("");
    setRows([]);
    setTopCategory({ income: undefined, expense: undefined });
    setShowErrors(false);
  };

  const adjust = useMutation(
    trpc.transactions.adjustBalance.mutationOptions({
      onSuccess: async (result) => {
        toast.success(result.created ? t("done") : t("nothing"));
        await invalidate();
        reset();
        onOpenChange(false);
      },
      onError: toastError,
    }),
  );

  const submit = () => {
    setShowErrors(true);

    if (!account || actualMinor === null || overflow || invalidKeys.size > 0) {
      return;
    }

    adjust.mutate({
      accountId: account.id,
      actualBalance: actualMinor,
      splits: [
        ...KINDS.map((kind) => ({
          kind,
          amount: top[kind],
          categoryId: topCategoryOf(kind),
        })),
        ...rows.map((row) => ({
          kind: row.kind,
          amount: amountOf(row),
          categoryId: row.categoryId,
        })),
      ].filter((split) => split.amount > 0),
    });
  };

  const updateRow = (key: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            disabled={
              !account || actualMinor === null || overflow || adjust.isPending
            }
            onClick={submit}
          >
            {adjust.isPending ? <Spinner /> : null}
            {tc("save")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <FieldGroup>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-3">
              <Field className="min-w-0">
                <FieldLabel htmlFor="adjust-account">{t("account")}</FieldLabel>
                <Select value={selectedId} onValueChange={setAccountId}>
                  <SelectTrigger id="adjust-account" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name} · {option.currencyCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field className="min-w-0" data-invalid={invalid}>
                <FieldLabel htmlFor="adjust-actual">{t("actual")}</FieldLabel>
                <Input
                  id="adjust-actual"
                  inputMode="decimal"
                  autoComplete="off"
                  className="tabular-nums"
                  value={actual}
                  aria-invalid={invalid}
                  onChange={(event) => setActual(event.target.value)}
                />
              </Field>
            </div>
            {invalid ? <FieldError>{te("is_minor_units")}</FieldError> : null}
            {account ? (
              <p className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("current")}</span>
                <Money amount={account.balance} sign={account.currencySign} />
              </p>
            ) : null}
            {difference !== null && account ? (
              <p className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("difference")}</span>
                <Money
                  amount={difference}
                  sign={account.currencySign}
                  showPlus
                  colored
                  className="font-semibold"
                />
              </p>
            ) : null}
          </div>

          {KINDS.map((kind) => (
            <AdjustGroup
              key={kind}
              kind={kind}
              currencySign={account?.currencySign}
              options={categoryOptionsByKind[kind]}
              topAmount={top[kind]}
              topCategoryId={topCategoryOf(kind)}
              onTopCategoryChange={(categoryId) =>
                setTopCategory((current) => ({
                  ...current,
                  [kind]: categoryId,
                }))
              }
              topInvalid={kind === dominant && overflow}
              rows={rows.filter((row) => row.kind === kind)}
              invalidKeys={showErrors ? invalidKeys : new Set()}
              onRowChange={updateRow}
              onRowRemove={(key) =>
                setRows((current) => current.filter((row) => row.key !== key))
              }
              onRowAdd={() =>
                setRows((current) => [
                  ...current,
                  { key: nextKey++, kind, amount: "", categoryId: null },
                ])
              }
            />
          ))}
          <button type="submit" hidden />
        </FieldGroup>
      </form>
    </ResponsiveDialog>
  );
}

/** One side of the split: a computed top row plus removable extra rows */
function AdjustGroup({
  kind,
  currencySign,
  options,
  topAmount,
  topCategoryId,
  onTopCategoryChange,
  topInvalid,
  rows,
  invalidKeys,
  onRowChange,
  onRowRemove,
  onRowAdd,
}: {
  kind: Kind;
  currencySign: string | undefined;
  options: CategoryOption[];
  topAmount: number;
  topCategoryId: string | null;
  onTopCategoryChange: (categoryId: string | null) => void;
  topInvalid: boolean;
  rows: Row[];
  invalidKeys: Set<number>;
  onRowChange: (key: number, patch: Partial<Row>) => void;
  onRowRemove: (key: number) => void;
  onRowAdd: () => void;
}) {
  const t = useTranslations("adjust");
  const tf = useTranslations("form");
  const total =
    Math.max(topAmount, 0) +
    rows.reduce((sum, row) => sum + (parseAmountInput(row.amount) ?? 0), 0);
  const title = t(kind === "income" ? "income" : "expenses");

  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium text-sm">{title}</h3>
        <Money
          amount={kind === "income" ? total : -total}
          sign={currencySign}
          showPlus
          colored
          className="font-semibold text-sm"
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2">
        <CategorySelect
          options={options}
          value={topCategoryId}
          onChange={onTopCategoryChange}
        />
        <Input
          aria-label={tf("amount")}
          disabled
          className="tabular-nums"
          aria-invalid={topInvalid}
          value={minorToInput(topAmount)}
        />
        <span className="size-8" />
        {rows.map((row) => (
          <AdjustRow
            key={row.key}
            row={row}
            options={options}
            invalid={invalidKeys.has(row.key)}
            onChange={(patch) => onRowChange(row.key, patch)}
            onRemove={() => onRowRemove(row.key)}
          />
        ))}
      </div>
      {topInvalid ? <FieldError>{t("overflow")}</FieldError> : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={onRowAdd}
      >
        <PlusIcon />
        {t("addRow")}
      </Button>
    </section>
  );
}

function AdjustRow({
  row,
  options,
  invalid,
  onChange,
  onRemove,
}: {
  row: Row;
  options: CategoryOption[];
  invalid: boolean;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("adjust");
  const tf = useTranslations("form");

  return (
    <>
      <CategorySelect
        options={options}
        value={row.categoryId}
        onChange={(categoryId) => onChange({ categoryId })}
      />
      <Input
        aria-label={tf("amount")}
        placeholder={tf("amount")}
        inputMode="decimal"
        autoComplete="off"
        autoFocus
        className="tabular-nums"
        aria-invalid={invalid}
        value={row.amount}
        onChange={(event) => onChange({ amount: event.target.value })}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("removeRow")}
        onClick={onRemove}
      >
        <Trash2Icon />
      </Button>
    </>
  );
}
