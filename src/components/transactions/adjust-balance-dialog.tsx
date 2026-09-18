"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Money } from "~/components/app/money";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
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
import { parseAmountInput } from "~/lib/money";
import { useTRPC } from "~/trpc/react";

/** Enter an account's actual balance; the difference is booked for you */
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
  const trpc = useTRPC();
  const toastError = useToastError();
  const invalidate = useInvalidateMoney();
  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const options = (accounts.data ?? []).filter((a) => a.canWrite && a.isActive);

  const [accountId, setAccountId] = useState("");
  const [actual, setActual] = useState("");
  const selectedId = accountId || options[0]?.id || "";
  const account = options.find((a) => a.id === selectedId);
  const actualMinor = parseAmountInput(actual, { allowSign: true });
  const invalid = actual.trim() !== "" && actualMinor === null;
  const difference =
    account && actualMinor !== null ? actualMinor - account.balance : null;

  const adjust = useMutation(
    trpc.transactions.adjustBalance.mutationOptions({
      onSuccess: async (result) => {
        toast.success(result.created ? t("done") : t("nothing"));
        await invalidate();
        setActual("");
        onOpenChange(false);
      },
      onError: toastError,
    }),
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
            disabled={!account || actualMinor === null || adjust.isPending}
            onClick={() =>
              account &&
              actualMinor !== null &&
              adjust.mutate({
                accountId: account.id,
                actualBalance: actualMinor,
              })
            }
          >
            {adjust.isPending ? <Spinner /> : null}
            {tc("save")}
          </Button>
        </>
      }
    >
      <FieldGroup>
        <Field>
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
        {account ? (
          <p className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("current")}</span>
            <Money amount={account.balance} sign={account.currencySign} />
          </p>
        ) : null}
        <Field data-invalid={invalid}>
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
          {invalid ? <FieldError>{te("is_minor_units")}</FieldError> : null}
        </Field>
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
      </FieldGroup>
    </ResponsiveDialog>
  );
}
