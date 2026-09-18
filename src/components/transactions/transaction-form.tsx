"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MinusIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DatePicker } from "~/components/app/date-picker";
import { FormError } from "~/components/app/form-error";
import { Money } from "~/components/app/money";
import { CategorySelect } from "~/components/transactions/category-select";
import { CounterpartyCombobox } from "~/components/transactions/counterparty-combobox";
import { useToday } from "~/components/transactions/transaction-groups";
import {
  type TransactionRowData,
  useDebtLabelText,
} from "~/components/transactions/transaction-item";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "~/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useToastError } from "~/hooks/use-toast-error";
import { categoryOptions } from "~/lib/category-options";
import { formatDisplayDate } from "~/lib/dates";
import { debtLabel } from "~/lib/debt-label";
import { formatMoney, minorToInput, parseAmountInput } from "~/lib/money";
import { cn } from "~/lib/utils";
import type {
  TransactionInputData,
  TransactionKind,
} from "~/lib/validators/transactions";
import { useTRPC } from "~/trpc/react";

const KINDS = ["expense", "income", "transfer", "debt"] as const;

const amountField = z
  .string()
  .refine((value) => value.trim() !== "", { error: "is_nonempty" })
  .refine(
    (value) => value.trim() === "" || (parseAmountInput(value) ?? 0) > 0,
    { error: "is_minor_units" },
  );

export const transactionFormSchema = z
  .object({
    kind: z.enum(KINDS),
    date: z.string().min(1, { error: "is_nonempty" }),
    amount: amountField,
    linkedAmount: z.string(),
    accountId: z.string().min(1, { error: "is_nonempty" }),
    linkedAccountId: z.string(),
    categoryId: z.string().nullable(),
    counterparty: z
      .object({ id: z.string().optional(), name: z.string() })
      .nullable(),
    direction: z.enum(["gave", "took"]),
    comment: z.string().max(500),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "transfer") {
      if (!value.linkedAccountId) {
        ctx.addIssue({
          code: "custom",
          message: "is_nonempty",
          path: ["linkedAccountId"],
        });
      } else if (value.linkedAccountId === value.accountId) {
        ctx.addIssue({
          code: "custom",
          message: "fields_integrity_same_account_transfer",
          path: ["linkedAccountId"],
        });
      }

      if (!((parseAmountInput(value.linkedAmount) ?? 0) > 0)) {
        ctx.addIssue({
          code: "custom",
          message: "is_minor_units",
          path: ["linkedAmount"],
        });
      }
    }

    if (value.kind === "debt" && !value.counterparty?.name.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "counterparty_required",
        path: ["counterparty"],
      });
    }
  });

export type TransactionFormValues = z.infer<typeof transactionFormSchema>;

/** Form values → the API input (amounts as positive minor units) */
export const toTransactionInput = (
  values: TransactionFormValues,
): TransactionInputData => {
  const base = {
    date: values.date,
    amount: parseAmountInput(values.amount) ?? 0,
    accountId: values.accountId,
    comment: values.comment.trim() || null,
  };
  const counterparty = values.counterparty
    ? values.counterparty.id
      ? { id: values.counterparty.id }
      : { name: values.counterparty.name }
    : null;

  switch (values.kind) {
    case "transfer":
      return {
        kind: "transfer",
        ...base,
        linkedAccountId: values.linkedAccountId,
        linkedAmount: parseAmountInput(values.linkedAmount) ?? 0,
      };
    case "debt":
      return {
        kind: "debt",
        ...base,
        direction: values.direction,
        counterparty: counterparty ?? { name: "" },
      };
    default:
      return {
        kind: values.kind,
        ...base,
        categoryId: values.categoryId,
        counterparty,
      };
  }
};

/** Initial values from an existing row (edit, submit) */
export const valuesFromRow = (
  row: TransactionRowData,
): TransactionFormValues => {
  const realLeg =
    row.kind === "debt" && row.account.type === "debt" && row.linked
      ? { accountId: row.linked.account.id, amount: row.linked.amount }
      : { accountId: row.account.id, amount: row.amount };

  return {
    kind: row.kind,
    date: row.date,
    amount: minorToInput(Math.abs(realLeg.amount)),
    linkedAmount: row.linked ? minorToInput(Math.abs(row.linked.amount)) : "",
    accountId: realLeg.accountId,
    linkedAccountId:
      row.kind === "transfer" ? (row.linked?.account.id ?? "") : "",
    categoryId: row.category && !row.category.deleted ? row.category.id : null,
    counterparty: row.counterparty
      ? { id: row.counterparty.id, name: row.counterparty.name }
      : null,
    direction: row.direction ?? "gave",
    comment: row.comment ?? "",
  };
};

export const useInvalidateMoney = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.transactions.pathFilter()),
      queryClient.invalidateQueries(trpc.accounts.pathFilter()),
      queryClient.invalidateQueries(trpc.counterparties.pathFilter()),
    ]);
};

type SubmitResult = {
  balances: { id: string; name: string; balance: number }[];
};

export type TransactionFormProps = {
  /** "create" keeps the form open for the next entry; others close on save */
  mode: "create" | "edit" | "submit";
  initial?: TransactionFormValues;
  /** Accounts the edited row uses stay selectable even if inactive */
  usedAccountIds?: string[];
  kindLocked?: boolean;
  onSubmit: (input: TransactionInputData) => Promise<SubmitResult>;
  onDone: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Extra fields rendered after the comment (the repeat section) */
  extraFields?: ReactNode;
  /** Blocks submitting while extra fields are invalid */
  extraValid?: (values: TransactionFormValues) => boolean;
  footer: (state: { pending: boolean; dirty: boolean }) => ReactNode;
  formId: string;
  /** The date part of the success toast; schedules show a date range */
  describeDate?: (date: string) => string;
};

export function TransactionForm({
  mode,
  initial,
  usedAccountIds = [],
  kindLocked = false,
  onSubmit,
  onDone,
  onDirtyChange,
  extraFields,
  extraValid,
  footer,
  formId,
  describeDate = formatDisplayDate,
}: TransactionFormProps) {
  const t = useTranslations("form");
  const tt = useTranslations("transactions");
  const locale = useLocale();
  const trpc = useTRPC();
  const today = useToday();
  const toastError = useToastError();
  const labelText = useDebtLabelText();
  const amountRef = useRef<HTMLInputElement>(null);
  const [linkedTouched, setLinkedTouched] = useState(mode !== "create");
  const [pending, setPending] = useState(false);

  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const categories = useQuery(trpc.categories.list.queryOptions());
  const counterparties = useQuery(trpc.counterparties.list.queryOptions());
  const balances = useQuery(trpc.counterparties.balances.queryOptions());

  // active accounts (plus the ones this row already uses), by usage
  const accountOptions = useMemo(
    () =>
      (accounts.data ?? []).filter(
        (account) =>
          account.canWrite &&
          (account.isActive || usedAccountIds.includes(account.id)),
      ),
    [accounts.data, usedAccountIds],
  );

  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: initial ?? {
      kind: "expense",
      date: today,
      amount: "",
      linkedAmount: "",
      accountId: "",
      linkedAccountId: "",
      categoryId: null,
      counterparty: null,
      direction: "gave",
      comment: "",
    },
  });

  const [kind, amount, accountId, linkedAccountId, direction, counterparty] =
    useWatch({
      control: form.control,
      name: [
        "kind",
        "amount",
        "accountId",
        "linkedAccountId",
        "direction",
        "counterparty",
      ],
    });

  // preselect the first account, and the first other one as the destination
  useEffect(() => {
    const first = accountOptions[0];

    if (!accountId && first) {
      form.setValue("accountId", first.id);
    }
  }, [accountId, accountOptions, form]);

  const linkedOptions = accountOptions.filter((a) => a.id !== accountId);

  useEffect(() => {
    if (kind !== "transfer") {
      return;
    }

    if (!linkedAccountId || linkedAccountId === accountId) {
      const first = linkedOptions[0];

      if (first) {
        form.setValue("linkedAccountId", first.id);
      }
    }
  }, [kind, accountId, linkedAccountId, linkedOptions, form]);

  // the linked amount mirrors the amount until it's edited by hand
  useEffect(() => {
    if (!linkedTouched) {
      form.setValue("linkedAmount", amount);
    }
  }, [amount, linkedTouched, form]);

  useEffect(() => {
    onDirtyChange?.(form.formState.isDirty);
  }, [form.formState.isDirty, onDirtyChange]);

  const account = accountOptions.find((a) => a.id === accountId);
  const linkedAccount = accountOptions.find((a) => a.id === linkedAccountId);
  const categoryItems = useMemo(
    () =>
      kind === "expense" || kind === "income"
        ? categoryOptions(categories.data ?? [], locale, kind)
        : [],
    [categories.data, kind, locale],
  );

  const negativeSign =
    kind === "expense" ||
    kind === "transfer" ||
    (kind === "debt" && direction === "gave");

  // debt context: the current balance with the picked person, per currency
  const withThem = counterparty?.id
    ? (balances.data ?? []).filter((b) => b.counterpartyId === counterparty.id)
    : [];
  const minor = parseAmountInput(amount) ?? 0;
  const balanceHere =
    withThem.find((b) => b.currencyId === account?.currencyId)?.sum ?? 0;
  const preview =
    kind === "debt" && counterparty?.name && minor > 0
      ? labelText(
          debtLabel(balanceHere, direction === "gave" ? minor : -minor),
          counterparty.name,
          account?.currencySign ?? "",
        )
      : null;

  const submit = form.handleSubmit(async (values) => {
    if (pending || (extraValid && !extraValid(values))) {
      return;
    }

    setPending(true);

    try {
      const input = toTransactionInput(values);
      const result = await onSubmit(input);

      const categoryLabel =
        categoryItems.find((c) => c.id === values.categoryId)?.label ?? null;
      const signed = negativeSign ? -input.amount : input.amount;
      toast.success(
        [
          describeDate(values.date),
          categoryLabel,
          values.comment.trim() || null,
          formatMoney(signed, account?.currencySign, { showPlus: true }),
          account?.name,
        ]
          .filter(Boolean)
          .join(" · "),
      );

      for (const balance of result.balances) {
        if (balance.balance < 0) {
          toast.warning(tt("toast.negative", { name: balance.name }));
        }
      }

      if (mode === "create") {
        // keep date, kind, accounts, category; clear the per-entry fields
        form.reset({
          ...values,
          amount: "",
          linkedAmount: "",
          comment: "",
          counterparty: null,
        });
        setLinkedTouched(false);
        requestAnimationFrame(() => amountRef.current?.focus());
      } else {
        onDone();
      }
    } catch (error) {
      toastError(error);
    } finally {
      setPending(false);
    }
  });

  if (accounts.isSuccess && accountOptions.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 py-2">
        <p className="text-muted-foreground text-sm">{t("noAccounts")}</p>
        <Button asChild>
          <Link href="/accounts">{t("createAccount")}</Link>
        </Button>
      </div>
    );
  }

  const accountSelect = (
    name: "accountId" | "linkedAccountId",
    label: string,
    options: typeof accountOptions,
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`${formId}-${name}`}>{label}</FieldLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger
              id={`${formId}-${name}`}
              className="w-full"
              aria-invalid={fieldState.invalid}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <span className="truncate">
                    {option.isActive
                      ? option.name
                      : t("inactive", { name: option.name })}
                  </span>
                  <span className="text-muted-foreground">
                    <Money amount={option.balance} sign={option.currencySign} />
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormError error={fieldState.error} />
        </Field>
      )}
    />
  );

  return (
    <form
      id={formId}
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <FieldGroup className="gap-4">
        <Controller
          control={form.control}
          name="kind"
          render={({ field }) => (
            <Tabs
              value={field.value}
              onValueChange={(value) =>
                field.onChange(value as TransactionKind)
              }
            >
              <TabsList className="w-full">
                {KINDS.map((option) => (
                  <TabsTrigger
                    key={option}
                    value={option}
                    disabled={kindLocked && option !== field.value}
                  >
                    {t(`kinds.${option}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        />

        {kind === "debt" ? (
          <Controller
            control={form.control}
            name="direction"
            render={({ field }) => (
              <ToggleGroup
                type="single"
                variant="outline"
                className="w-full"
                value={field.value}
                onValueChange={(value) => value && field.onChange(value)}
              >
                <ToggleGroupItem value="gave" className="flex-1">
                  {t("direction.gave")}
                </ToggleGroupItem>
                <ToggleGroupItem value="took" className="flex-1">
                  {t("direction.took")}
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          />
        ) : null}

        <div className="grid grid-cols-[1fr_1.3fr] gap-3">
          <Controller
            control={form.control}
            name="date"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${formId}-date`}>{t("date")}</FieldLabel>
                <DatePicker
                  id={`${formId}-date`}
                  value={field.value}
                  onChange={(value) => field.onChange(value ?? "")}
                />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="amount"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${formId}-amount`}>
                  {t("amount")}
                </FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    {negativeSign ? (
                      <MinusIcon className="text-destructive" />
                    ) : (
                      <PlusIcon className="text-emerald-600 dark:text-emerald-400" />
                    )}
                  </InputGroupAddon>
                  <InputGroupInput
                    {...field}
                    ref={(element) => {
                      field.ref(element);
                      amountRef.current = element;
                    }}
                    id={`${formId}-amount`}
                    inputMode="decimal"
                    autoComplete="off"
                    autoFocus={mode === "create"}
                    className="tabular-nums"
                    aria-invalid={fieldState.invalid}
                  />
                  {account ? (
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>{account.currencySign}</InputGroupText>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
                <FormError error={fieldState.error} />
              </Field>
            )}
          />
        </div>

        {kind === "expense" || kind === "income" ? (
          <Controller
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={`${formId}-category`}>
                  {t("category")}
                </FieldLabel>
                <CategorySelect
                  id={`${formId}-category`}
                  options={categoryItems}
                  value={field.value}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
        ) : null}

        {accountSelect(
          "accountId",
          kind === "transfer" ? t("fromAccount") : t("account"),
          accountOptions,
        )}

        {kind === "transfer" ? (
          <div className="grid grid-cols-[1.3fr_1fr] gap-3">
            {accountSelect("linkedAccountId", t("toAccount"), linkedOptions)}
            <Controller
              control={form.control}
              name="linkedAmount"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={`${formId}-linked-amount`}>
                    {t("linkedAmount")}
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      {...field}
                      onChange={(event) => {
                        setLinkedTouched(true);
                        field.onChange(event);
                      }}
                      id={`${formId}-linked-amount`}
                      inputMode="decimal"
                      autoComplete="off"
                      className="tabular-nums"
                      aria-invalid={fieldState.invalid}
                    />
                    {linkedAccount ? (
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>
                          {linkedAccount.currencySign}
                        </InputGroupText>
                      </InputGroupAddon>
                    ) : null}
                  </InputGroup>
                  <FormError error={fieldState.error} />
                </Field>
              )}
            />
          </div>
        ) : null}

        {kind !== "transfer" ? (
          <Controller
            control={form.control}
            name="counterparty"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${formId}-counterparty`}>
                  {kind === "debt" ? t("debtCounterparty") : t("counterparty")}
                </FieldLabel>
                <CounterpartyCombobox
                  id={`${formId}-counterparty`}
                  options={counterparties.data ?? []}
                  value={field.value ? { ...field.value } : null}
                  onChange={field.onChange}
                  invalid={fieldState.invalid}
                />
                <FormError error={fieldState.error} />
                {kind === "debt" && counterparty ? (
                  <div className="flex flex-col gap-0.5 text-muted-foreground text-sm">
                    {withThem.length === 0 && counterparty.id ? (
                      <span>
                        {t("balanceWith.settled", { name: counterparty.name })}
                      </span>
                    ) : null}
                    {withThem.map((b) => (
                      <span key={b.currencyId}>
                        {t(
                          b.sum > 0 ? "balanceWith.oweMe" : "balanceWith.iOwe",
                          {
                            name: counterparty.name,
                            amount: formatMoney(
                              Math.abs(b.sum),
                              b.currencySign,
                            ),
                          },
                        )}
                      </span>
                    ))}
                    {preview ? (
                      <span className="text-foreground">
                        {t("preview", { label: preview })}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </Field>
            )}
          />
        ) : null}

        <Controller
          control={form.control}
          name="comment"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${formId}-comment`}>
                {t("comment")}
              </FieldLabel>
              <Textarea
                {...field}
                id={`${formId}-comment`}
                rows={2}
                maxLength={500}
                className="min-h-0 resize-none"
              />
              <FormError error={fieldState.error} />
            </Field>
          )}
        />

        {extraFields}

        <p className={cn("hidden text-muted-foreground text-xs sm:block")}>
          {t("submitHint")}
        </p>
      </FieldGroup>
      {footer({ pending, dirty: form.formState.isDirty })}
    </form>
  );
}
