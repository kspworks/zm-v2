"use client";

import { EllipsisIcon, ListPlusIcon, ScaleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AdjustBalanceDialog } from "~/components/transactions/adjust-balance-dialog";
import { BulkEntryDialog } from "~/components/transactions/bulk-entry-dialog";
import { TransactionsView } from "~/components/transactions/transactions-view";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

/** The Transactions page with its secondary entry points */
export function TransactionsPage() {
  const t = useTranslations("transactions");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  return (
    <>
      <TransactionsView
        extraActions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label={t("bulk")}>
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setBulkOpen(true)}>
                <ListPlusIcon />
                {t("bulk")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAdjustOpen(true)}>
                <ScaleIcon />
                {t("adjust")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <BulkEntryDialog open={bulkOpen} onOpenChange={setBulkOpen} />
      <AdjustBalanceDialog open={adjustOpen} onOpenChange={setAdjustOpen} />
    </>
  );
}
