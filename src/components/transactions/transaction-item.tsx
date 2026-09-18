"use client";

import { ArrowRightIcon, CheckCheckIcon, RepeatIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Money } from "~/components/app/money";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { Locale } from "~/i18n/config";
import type { DebtLabel } from "~/lib/debt-label";
import { describeSchedule } from "~/lib/describe-schedule";
import { formatMoney } from "~/lib/money";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/types";

export type TransactionRowData =
  RouterOutputs["transactions"]["list"]["items"][number];

/** The debt account is always shown by its localized name */
export const useAccountName = () => {
  const t = useTranslations("accounts.types");

  return (account: { name: string; type: string }) =>
    account.type === "debt" ? t("debt") : account.name;
};

/**
 * Debt wording (section 14.1) as text: "I lent to Alex", or for a split
 * "Alex repaid me 300 ₴ · I borrowed 200 ₴". Forecast wording for planned
 * rows.
 */
export const useDebtLabelText = () => {
  const t = useTranslations("transactions");

  return (
    label: DebtLabel & { forecast?: boolean },
    name: string,
    currencySign: string,
  ): string => {
    const prefix = label.forecast ? "debt.forecast" : "debt";
    const [first, second] = label.parts;

    if (first && !second) {
      const key = {
        lent: "lentTo",
        borrowed: "borrowedFrom",
        repaid: "repaidTo",
        repaidToMe: "repaidMe",
      } as const;

      return t(`${prefix}.${key[first.kind]}`, { name });
    }

    return label.parts
      .map((part) =>
        t(`${prefix}.${part.kind}`, {
          name,
          amount: formatMoney(part.amount, currencySign),
        }),
      )
      .join(" · ");
  };
};

/** A debt row's description; old rows without a counterparty say Gave/Took */
export const useDebtDescription = () => {
  const t = useTranslations("transactions");
  const labelText = useDebtLabelText();

  return (row: TransactionRowData): string => {
    const name = row.counterparty?.name ?? "";

    if (!row.debtLabel) {
      const direction = row.direction === "took" ? t("took") : t("gave");

      return name ? `${direction} · ${name}` : direction;
    }

    const sign =
      row.account.type === "debt"
        ? (row.linked?.account.currencySign ?? "")
        : row.account.currencySign;

    return labelText(row.debtLabel, name, sign);
  };
};

/** Category, transfer or debt description for a row */
export const useRowDescription = () => {
  const t = useTranslations("transactions");
  const debtDescription = useDebtDescription();

  return (row: TransactionRowData): string => {
    if (row.kind === "debt") {
      return debtDescription(row);
    }

    if (row.batchId) {
      return t("transfer");
    }

    if (!row.category) {
      return t("noCategory");
    }

    if (row.category.deleted) {
      return t("deletedCategory");
    }

    return row.category.parentName
      ? `${row.category.parentName} → ${row.category.name}`
      : row.category.name;
  };
};

/**
 * The display amount: negated when the primary leg is on the debt account,
 * unsigned for a same-type, same-amount transfer between own accounts.
 */
export const displayAmount = (row: TransactionRowData) => {
  const primaryOnDebt = row.account.type === "debt";
  const amount = primaryOnDebt ? -row.amount : row.amount;
  const sign = primaryOnDebt
    ? (row.linked?.account.currencySign ?? row.account.currencySign)
    : row.account.currencySign;
  const linked = row.linked;
  const hideSign =
    !!linked &&
    linked.account.type === row.account.type &&
    Math.abs(linked.amount) === Math.abs(row.amount);
  const secondLine =
    linked && Math.abs(linked.amount) !== Math.abs(row.amount)
      ? { amount: linked.amount, sign: linked.account.currencySign }
      : null;

  return { amount, sign, hideSign, secondLine };
};

export function TransactionItem({
  row,
  actions,
}: {
  row: TransactionRowData;
  actions?: ReactNode;
}) {
  const t = useTranslations("transactions");
  const locale = useLocale() as Locale;
  const description = useRowDescription()(row);
  const accountName = useAccountName();
  const { amount, sign, hideSign, secondLine } = displayAmount(row);
  const counterpartyNote =
    row.kind === "expense" || row.kind === "income"
      ? row.counterparty?.name
      : null;
  const comment = row.comment ?? "";

  return (
    <div className="group flex items-start gap-3 px-3 py-2.5 sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate font-medium text-sm",
              row.category?.deleted && "text-muted-foreground italic",
            )}
          >
            {description}
          </span>
          {counterpartyNote ? (
            <span className="shrink-0 truncate text-muted-foreground text-sm">
              · {counterpartyNote}
            </span>
          ) : null}
          {row.debtLabel?.settles ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <CheckCheckIcon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              </TooltipTrigger>
              <TooltipContent>{t("debt.settled")}</TooltipContent>
            </Tooltip>
          ) : null}
          {row.schedule ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <RepeatIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label={describeSchedule(row.schedule, locale)}
                />
              </TooltipTrigger>
              <TooltipContent>
                {describeSchedule(row.schedule, locale)}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {comment ? (
          comment.length > 50 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="line-clamp-1 text-muted-foreground text-sm">
                  {comment}
                </p>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm whitespace-pre-wrap">
                {comment}
              </TooltipContent>
            </Tooltip>
          ) : (
            <p className="line-clamp-1 text-muted-foreground text-sm">
              {comment}
            </p>
          )
        ) : null}
        <p className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
          <span className="truncate">{accountName(row.account)}</span>
          {row.linked ? (
            <>
              <ArrowRightIcon className="size-3 shrink-0" />
              <span className="truncate">
                {accountName(row.linked.account)}
              </span>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <Money
          amount={amount}
          sign={sign}
          showPlus={!hideSign}
          hideSign={hideSign}
          colored={!hideSign}
          className="font-semibold text-sm"
        />
        {secondLine ? (
          <Money
            amount={secondLine.amount}
            sign={secondLine.sign}
            showPlus
            className="text-muted-foreground text-xs"
          />
        ) : null}
      </div>
      {actions ? <div className="-mr-2 shrink-0">{actions}</div> : null}
    </div>
  );
}
