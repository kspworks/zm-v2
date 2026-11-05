"use client";

import { effectTsResolver } from "@hookform/resolvers/effect-ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormError } from "~/components/app/form-error";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import { Button } from "~/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
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
import { Switch } from "~/components/ui/switch";
import { useToastError } from "~/hooks/use-toast-error";
import { minorToInput, parseAmountInput } from "~/lib/money";
import { USER_ACCOUNT_TYPES } from "~/lib/validators/accounts";
import { message, nonEmpty, trimmedString } from "~/lib/validators/common";
import { useTRPC } from "~/trpc/react";

const formSchema = Schema.Struct({
  name: trimmedString(255),
  currencyId: Schema.String.check(nonEmpty),
  type: Schema.Literals(USER_ACCOUNT_TYPES),
  initialBalance: Schema.String.check(
    Schema.makeFilter(
      (value: string) =>
        value.trim() === "" ||
        parseAmountInput(value, { allowSign: true }) !== null,
      message("is_minor_units"),
    ),
  ),
  isActive: Schema.Boolean,
});

type FormValues = typeof formSchema.Type;

export type EditableAccount = {
  id: string;
  name: string;
  currencyId: string;
  type: (typeof USER_ACCOUNT_TYPES)[number] | "debt";
  initialBalance: number;
  isActive: boolean;
};

export function AccountFormDialog({
  open,
  account,
  onOpenChange,
}: {
  open: boolean;
  account: EditableAccount | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("accounts");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const currencies = useQuery(trpc.accounts.currencies.queryOptions());

  const defaults = (): FormValues => ({
    name: account?.name ?? "",
    currencyId:
      account?.currencyId ??
      currencies.data?.find((currency) => currency.code === "UAH")?.id ??
      currencies.data?.[0]?.id ??
      "",
    type: account && account.type !== "debt" ? account.type : "card",
    initialBalance: account ? minorToInput(account.initialBalance) : "0",
    isActive: account?.isActive ?? true,
  });

  const form = useForm<FormValues>({
    resolver: effectTsResolver(formSchema),
    defaultValues: defaults(),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens, never while the user types
  useEffect(() => {
    if (open) {
      form.reset(defaults());
    }
  }, [open, account]);

  // the currency list may arrive after opening: fill the default in place
  // without touching anything the user already typed
  const defaultCurrencyId = defaults().currencyId;

  useEffect(() => {
    if (open && defaultCurrencyId && !form.getValues("currencyId")) {
      form.setValue("currencyId", defaultCurrencyId);
    }
  }, [open, defaultCurrencyId, form]);

  const onSuccess = async () => {
    toast.success(tc("saved"));
    await queryClient.invalidateQueries(trpc.accounts.pathFilter());
    onOpenChange(false);
  };

  const create = useMutation(
    trpc.accounts.create.mutationOptions({ onSuccess, onError: toastError }),
  );
  const update = useMutation(
    trpc.accounts.update.mutationOptions({ onSuccess, onError: toastError }),
  );
  // a save before the currency list arrives would fail on the still-empty
  // currency, and the error stays once the default fills in
  const pending = create.isPending || update.isPending || currencies.isPending;

  const submit = form.handleSubmit((values) => {
    const payload = {
      ...values,
      initialBalance:
        parseAmountInput(values.initialBalance, { allowSign: true }) ?? 0,
    };

    if (account) {
      update.mutate({ id: account.id, ...payload });
    } else {
      create.mutate(payload);
    }
  });

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={account ? t("editTitle") : t("createTitle")}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {form.formState.isDirty ? tc("cancel") : tc("close")}
          </Button>
          <Button type="submit" form="account-form" disabled={pending}>
            {pending ? <Spinner /> : null}
            {tc("save")}
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit} noValidate>
        <FieldGroup>
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="account-name">{t("name")}</FieldLabel>
                <Input
                  {...field}
                  id="account-name"
                  autoFocus
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                />
                <FormError error={fieldState.error} />
              </Field>
            )}
          />
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={form.control}
              name="currencyId"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="account-currency">
                    {t("currency")}
                  </FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="account-currency" className="w-full">
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
                  <FormError error={fieldState.error} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="account-type">{t("type")}</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="account-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {USER_ACCOUNT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(`types.${type}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>
          <Controller
            control={form.control}
            name="initialBalance"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="account-balance">
                  {t("initialBalance")}
                </FieldLabel>
                <Input
                  {...field}
                  id="account-balance"
                  inputMode="decimal"
                  autoComplete="off"
                  className="tabular-nums"
                  aria-invalid={fieldState.invalid}
                />
                <FormError error={fieldState.error} />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="account-active">
                    {t("active")}
                  </FieldLabel>
                  <FieldDescription>{t("activeHint")}</FieldDescription>
                </FieldContent>
                <Switch
                  id="account-active"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </Field>
            )}
          />
        </FieldGroup>
      </form>
    </ResponsiveDialog>
  );
}
