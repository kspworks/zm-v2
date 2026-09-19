"use client";

import { useQuery } from "@tanstack/react-query";
import { FilterIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { DatePicker } from "~/components/app/date-picker";
import { MultiSelect } from "~/components/app/multi-select";
import type {
  FilterState,
  SetFilterState,
} from "~/components/transactions/use-filter";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { useIsMobile } from "~/hooks/use-mobile";
import { categoryOptions } from "~/lib/category-options";
import { amountFilterRange } from "~/lib/money";
import { NO_CATEGORY } from "~/lib/validators/transactions";
import { useTRPC } from "~/trpc/react";

/** Applies a text value after 500 ms of quiet, and only while it's valid */
const useDebouncedField = (
  value: string | null,
  apply: (value: string | null) => void,
  isValid: (value: string) => boolean,
) => {
  const [text, setText] = useState(value ?? "");

  // follow outside changes (reset, back/forward)
  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  useEffect(() => {
    const trimmed = text.trim();

    if (trimmed === (value ?? "") || (trimmed && !isValid(trimmed))) {
      return;
    }

    const timer = setTimeout(() => apply(trimmed || null), 500);

    return () => clearTimeout(timer);
  }, [text, value, apply, isValid]);

  return [text, setText] as const;
};

const validAmount = (value: string) => amountFilterRange(value) !== null;
const always = () => true;

export const activeFilterCount = (state: FilterState, withDates = true) =>
  (state.accounts.length ? 1 : 0) +
  (state.categories.length ? 1 : 0) +
  (state.counterparties.length ? 1 : 0) +
  (withDates && (state.startDate || state.endDate) ? 1 : 0) +
  (state.amount ? 1 : 0) +
  (state.comment ? 1 : 0);

function FilterFields({
  state,
  setState,
  requireDates,
}: {
  state: FilterState;
  setState: SetFilterState;
  requireDates: boolean;
}) {
  const t = useTranslations("filters");
  const te = useTranslations("errors");
  const locale = useLocale();
  const trpc = useTRPC();
  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const categories = useQuery(trpc.categories.list.queryOptions());
  const counterparties = useQuery(trpc.counterparties.list.queryOptions());

  const [comment, setComment] = useDebouncedField(
    state.comment,
    (value) => void setState({ comment: value }),
    always,
  );
  const [amount, setAmount] = useDebouncedField(
    state.amount,
    (value) => void setState({ amount: value }),
    validAmount,
  );

  const accountOptions = useMemo(
    () =>
      (accounts.data ?? [])
        .filter((a) => a.isActive || state.accounts.includes(a.id))
        .map((a) => ({ value: a.id, label: a.name, hint: a.currencyCode })),
    [accounts.data, state.accounts],
  );

  const categoryItems = useMemo(
    () => [
      { value: NO_CATEGORY, label: t("noCategory") },
      ...categoryOptions(categories.data ?? [], locale).map((option) => ({
        value: option.id,
        label: option.label,
      })),
    ],
    [categories.data, locale, t],
  );

  const counterpartyOptions = useMemo(
    () =>
      (counterparties.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    [counterparties.data],
  );

  const reversed =
    !!state.startDate && !!state.endDate && state.startDate > state.endDate;
  const amountInvalid = amount.trim() !== "" && !validAmount(amount.trim());

  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel htmlFor="filter-accounts">{t("accounts")}</FieldLabel>
        <MultiSelect
          id="filter-accounts"
          label={t("selected", { count: state.accounts.length })}
          options={accountOptions}
          value={state.accounts}
          onChange={(value) => void setState({ accounts: value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="filter-categories">{t("categories")}</FieldLabel>
        <MultiSelect
          id="filter-categories"
          label={t("selected", { count: state.categories.length })}
          options={categoryItems}
          value={state.categories}
          onChange={(value) => void setState({ categories: value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="filter-counterparties">
          {t("counterparties")}
        </FieldLabel>
        <MultiSelect
          id="filter-counterparties"
          label={t("selected", { count: state.counterparties.length })}
          options={counterpartyOptions}
          value={state.counterparties}
          onChange={(value) => void setState({ counterparties: value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field data-invalid={reversed}>
          <FieldLabel htmlFor="filter-from">{t("from")}</FieldLabel>
          <DatePicker
            id="filter-from"
            value={state.startDate}
            clearable={!requireDates}
            invalid={reversed}
            placeholder="—"
            onChange={(value) => {
              if (value || !requireDates) {
                void setState({ startDate: value });
              }
            }}
          />
          {reversed ? (
            <FieldError>{te("start_date_lte_end_date")}</FieldError>
          ) : null}
        </Field>
        <Field data-invalid={reversed}>
          <FieldLabel htmlFor="filter-to">{t("to")}</FieldLabel>
          <DatePicker
            id="filter-to"
            value={state.endDate}
            clearable={!requireDates}
            invalid={reversed}
            placeholder="—"
            onChange={(value) => {
              if (value || !requireDates) {
                void setState({ endDate: value });
              }
            }}
          />
          {reversed ? (
            <FieldError>{te("end_date_gte_start_date")}</FieldError>
          ) : null}
        </Field>
      </div>
      <Field data-invalid={amountInvalid}>
        <FieldLabel htmlFor="filter-amount">{t("amount")}</FieldLabel>
        <Input
          id="filter-amount"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          aria-invalid={amountInvalid}
          onChange={(event) => setAmount(event.target.value)}
        />
        {amountInvalid ? <FieldError>{te("is_minor_units")}</FieldError> : null}
      </Field>
      <Field>
        <FieldLabel htmlFor="filter-comment">{t("comment")}</FieldLabel>
        <Input
          id="filter-comment"
          autoComplete="off"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </Field>
    </FieldGroup>
  );
}

export function FilterButton({
  state,
  setState,
  reset,
  requireDates = false,
}: {
  state: FilterState;
  setState: SetFilterState;
  reset: () => void;
  requireDates?: boolean;
}) {
  const t = useTranslations("filters");
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const count = activeFilterCount(state, !requireDates);

  const trigger = (
    <Button variant="outline" size="sm">
      <FilterIcon />
      <span className="max-sm:sr-only">{t("title")}</span>
      {count > 0 ? <Badge className="ml-0.5 px-1.5">{count}</Badge> : null}
    </Button>
  );

  const fields = (
    <FilterFields
      state={state}
      setState={setState}
      requireDates={requireDates}
    />
  );

  const resetButton = (variant: "ghost" | "outline") => (
    <Button variant={variant} disabled={count === 0} onClick={reset}>
      {t("reset")}
    </Button>
  );

  return isMobile ? (
    <>
      <span onClickCapture={() => setOpen(true)}>{trigger}</span>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[92svh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{t("title")}</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4">{fields}</div>
          <DrawerFooter>
            <Button onClick={() => setOpen(false)}>{t("apply")}</Button>
            {resetButton("outline")}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  ) : (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        {fields}
        <div className="flex justify-end">{resetButton("ghost")}</div>
      </PopoverContent>
    </Popover>
  );
}
