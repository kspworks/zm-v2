"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { PlannedRowMenu } from "~/components/planned/planned-row-actions";
import {
  TransactionItem,
  type TransactionRowData,
} from "~/components/transactions/transaction-item";
import type { TransactionFilter } from "~/lib/validators/transactions";
import { useTRPC } from "~/trpc/react";

/** "Planned and overdue": planned rows due today or earlier */
export function OverdueBlock({
  filter,
  onSubmit,
  onEditSchedule,
  onDelete,
}: {
  filter: TransactionFilter;
  onSubmit: (row: TransactionRowData) => void;
  onEditSchedule: (row: TransactionRowData) => void;
  onDelete: (row: TransactionRowData) => void;
}) {
  const t = useTranslations("transactions");
  const trpc = useTRPC();
  const overdue = useQuery(trpc.transactions.overdue.queryOptions({ filter }));

  if (!overdue.data?.length) {
    return null;
  }

  return (
    <section className="overflow-hidden rounded-lg border border-amber-500/40 bg-amber-500/5">
      <h2 className="px-3 pt-3 pb-1 font-semibold text-amber-700 text-sm sm:px-4 dark:text-amber-400">
        {t("overdueTitle")}
      </h2>
      <div className="divide-y divide-amber-500/20">
        {overdue.data.map((row) => (
          <TransactionItem
            key={row.id}
            row={row}
            actions={
              <PlannedRowMenu
                row={row}
                onSubmit={() => onSubmit(row)}
                onEditSchedule={() => onEditSchedule(row)}
                onDelete={() => onDelete(row)}
              />
            }
          />
        ))}
      </div>
    </section>
  );
}
