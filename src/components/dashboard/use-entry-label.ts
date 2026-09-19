"use client";

import { useTranslations } from "next-intl";

import type { DashboardEntry } from "~/lib/dashboard";

/** Short description of a dashboard entry: category, transfer or debt */
export const useEntryLabel = () => {
  const t = useTranslations("transactions");

  return (entry: DashboardEntry): string => {
    if (entry.kind === "transfer") {
      return entry.fromAccount && entry.toAccount
        ? `${entry.fromAccount} → ${entry.toAccount}`
        : t("transfer");
    }

    if (entry.kind === "debt") {
      const direction = t(entry.net < 0 ? "gave" : "took");

      return entry.counterparty
        ? `${direction} · ${entry.counterparty}`
        : direction;
    }

    return entry.category ?? entry.comment ?? t("noCategory");
  };
};
