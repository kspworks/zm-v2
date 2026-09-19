"use client";

import { WalletIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { PageHeader } from "~/components/app/page-header";
import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";

/**
 * Shell shared by the Transactions and Planned pages: the list on the left,
 * the balances sidebar on the right (a sheet on smaller screens).
 */
export function LedgerLayout({
  title,
  filters,
  actions,
  sidebar,
  children,
}: {
  title: string;
  filters?: ReactNode;
  actions?: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("sidebar");
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <>
            {filters}
            <Button
              variant="outline"
              size="icon"
              className="lg:hidden"
              aria-label={t("title")}
              onClick={() => setSheetOpen(true)}
            >
              <WalletIcon />
            </Button>
            {actions}
          </>
        }
      />
      <div className="mx-auto grid w-full max-w-6xl gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
        <aside className="hidden lg:block">
          <div className="sticky top-20">{sidebar}</div>
        </aside>
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-80 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("title")}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">{sidebar}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
