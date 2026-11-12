"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AmountInput } from "~/components/app/amount-input";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import type { Budget } from "~/components/budgets/budget-progress";
import { CategorySelect } from "~/components/transactions/category-select";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { usePrimaryCurrency } from "~/hooks/use-primary-currency";
import { useToastError } from "~/hooks/use-toast-error";
import { categoryOptions } from "~/lib/category-options";
import { evaluateAmount, formatMoney } from "~/lib/money";
import { useTRPC } from "~/trpc/react";

/** A new monthly limit, or a new amount for an existing one */
export function BudgetFormDialog({
  open,
  budget,
  onOpenChange,
}: {
  open: boolean;
  budget: Budget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("budgets");
  const tc = useTranslations("common");
  const locale = useLocale();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const primary = usePrimaryCurrency();
  const categories = useQuery(trpc.categories.list.queryOptions());
  const currencies = useQuery(trpc.accounts.currencies.queryOptions());

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [currencyId, setCurrencyId] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (open) {
      setCategoryId(budget?.categoryId ?? null);
      setCurrencyId(budget?.currencyId ?? primary.currencyId ?? "");
      setAmount(budget ? formatMoney(budget.amount).replace(/\s/g, "") : "");
    }
  }, [open, budget, primary.currencyId]);

  const save = useMutation(
    trpc.budgets.save.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.budgets.pathFilter());
        onOpenChange(false);
      },
      onError: toastError,
    }),
  );

  const minor = evaluateAmount(amount);
  const valid = !!categoryId && !!currencyId && (minor ?? 0) > 0;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={budget ? t("editTitle") : t("newTitle")}
      description={t("formHint")}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            type="submit"
            form="budget-form"
            disabled={!valid || save.isPending}
          >
            {save.isPending ? <Spinner /> : null}
            {tc("save")}
          </Button>
        </>
      }
    >
      <form
        id="budget-form"
        onSubmit={(event) => {
          event.preventDefault();

          if (valid && categoryId) {
            save.mutate({ categoryId, currencyId, amount: minor ?? 0 });
          }
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="budget-category">{t("category")}</FieldLabel>
            {/* the pair is the budget's identity, so editing keeps it */}
            <div
              className={budget ? "pointer-events-none opacity-60" : undefined}
            >
              <CategorySelect
                id="budget-category"
                options={categoryOptions(
                  categories.data ?? [],
                  locale,
                  "expense",
                )}
                value={categoryId}
                onChange={setCategoryId}
              />
            </div>
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
            <Field>
              <FieldLabel htmlFor="budget-amount">{t("amount")}</FieldLabel>
              <AmountInput
                id="budget-amount"
                value={amount}
                onChange={setAmount}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="budget-currency">{t("currency")}</FieldLabel>
              <Select
                value={currencyId}
                onValueChange={setCurrencyId}
                disabled={!!budget}
              >
                <SelectTrigger id="budget-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.data?.map((currency) => (
                    <SelectItem key={currency.id} value={currency.id}>
                      {currency.code} {currency.sign}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldGroup>
      </form>
    </ResponsiveDialog>
  );
}
