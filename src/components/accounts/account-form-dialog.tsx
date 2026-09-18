"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import { useTRPC } from "~/trpc/react";

const formSchema = z.object({
  name: z.string().trim().min(1).max(255),
  currencyId: z.string().min(1),
  type: z.enum(USER_ACCOUNT_TYPES),
  initialBalance: z
    .string()
    .refine(
      (value) =>
        value.trim() === "" ||
        parseAmountInput(value, { allowSign: true }) !== null,
      { error: "is_minor_units" },
    ),
  isActive: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

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
    resolver: zodResolver(formSchema),
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
  const pending = create.isPending || update.isPending;

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
