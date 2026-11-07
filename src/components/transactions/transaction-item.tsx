"use client";

import { ArrowRightIcon, CheckCheckIcon, RepeatIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useCallback } from "react";

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
 * Debt wording (see `~/lib/debt-label`) as text: "I lent to Alex", or for a
 * split "Alex repaid me 300 ₴ · I borrowed 200 ₴". Forecast wording for
 * planned rows.
 */
export const useDebtLabelText = () => {
  const t = useTranslations("transactions");

  return useCallback(
    (
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
    },
    [t],
  );
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
 * shown without a sign when both legs sit on accounts of the same type and
 * move the same amount (a plain transfer).
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
  onOpen,
}: {
  row: TransactionRowData;
  actions?: ReactNode;
  /** What clicking the row does: opens its form */
  onOpen?: () => void;
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
    // biome-ignore lint/a11y/noStaticElementInteractions: a wider mouse and touch target for the title button, which is the keyboard and screen-reader path
    // biome-ignore lint/a11y/useKeyWithClickEvents: the title button handles the keyboard
    <div
      className={cn(
        "group flex items-start gap-3 px-3 py-2.5 sm:px-4 md:items-center md:py-1",
        onOpen && "hover:bg-accent/50 cursor-pointer transition-colors",
      )}
      onClick={
        onOpen
          ? () => {
              // selecting a comment to copy it is not a click on the row
              if (window.getSelection()?.isCollapsed !== false) {
                onOpen();
              }
            }
          : undefined
      }
    >
      {/* stacked on phones, one line from md up */}
      <div className="min-w-0 flex-1 md:flex md:items-center md:gap-3">
        <div className="flex min-w-0 items-center gap-1.5 md:max-w-[55%] md:shrink-0">
          {onOpen ? (
            <button
              type="button"
              className={cn(
                "focus-visible:ring-ring truncate rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-2",
                row.category?.deleted && "text-muted-foreground italic",
              )}
            >
              {description}
            </button>
          ) : (
            <span
              className={cn(
                "truncate text-sm font-medium",
                row.category?.deleted && "text-muted-foreground italic",
              )}
            >
              {description}
            </span>
          )}
          {counterpartyNote ? (
            <span className="text-muted-foreground min-w-0 truncate text-sm">
              · {counterpartyNote}
            </span>
          ) : null}
          {row.debtLabel?.settles ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <CheckCheckIcon className="text-positive size-3.5 shrink-0" />
              </TooltipTrigger>
              <TooltipContent>{t("debt.settled")}</TooltipContent>
            </Tooltip>
          ) : null}
          {row.schedule ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <RepeatIcon
                  className="text-muted-foreground size-3.5 shrink-0"
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
                <p className="text-muted-foreground line-clamp-1 text-sm md:min-w-0 md:flex-1">
                  {comment}
                </p>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm whitespace-pre-wrap">
                {comment}
              </TooltipContent>
            </Tooltip>
          ) : (
            <p className="text-muted-foreground line-clamp-1 text-sm md:min-w-0 md:flex-1">
              {comment}
            </p>
          )
        ) : null}
        <p className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs md:ml-auto md:max-w-48 md:shrink-0 md:justify-end">
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
          className="text-sm font-semibold"
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
      {actions ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: only keeps the menu's clicks from reaching the row
        // biome-ignore lint/a11y/useKeyWithClickEvents: nothing to do from the keyboard here
        <div
          className="-mr-2 shrink-0"
          onClick={(event) => event.stopPropagation()}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
