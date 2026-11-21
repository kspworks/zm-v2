"use client";

import { CoinsIcon, type LucideIcon } from "lucide-react";
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
 * Shell shared by the Dashboard and the ledger pages (Transactions, Planned,
 * Accounts, Categories): the content on the left, a sidebar on the right (a
 * sheet on smaller screens). The sidebar is the balances unless the page
 * names it otherwise.
 */
export function LedgerLayout({
  title,
  filters,
  actions,
  sidebar,
  summary,
  sidebarTitle,
  sidebarIcon: SidebarIcon = CoinsIcon,
  children,
}: {
  title: string;
  filters?: ReactNode;
  actions?: ReactNode;
  sidebar: ReactNode;
  /** The headline shown when the sidebar is not; tapping it opens the sheet */
  summary?: ReactNode;
  /** What the sidebar is called on its header button and sheet */
  sidebarTitle?: string;
  sidebarIcon?: LucideIcon;
  children: ReactNode;
}) {
  const t = useTranslations("sidebar");
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetTitle = sidebarTitle ?? t("title");

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <>
            {filters}
            {summary ? null : (
              <Button
                variant="outline"
                size="icon-sm"
                className="lg:hidden"
                aria-label={sheetTitle}
                onClick={() => setSheetOpen(true)}
              >
                <SidebarIcon />
              </Button>
            )}
            {actions}
          </>
        }
      />
      <div className="mx-auto grid w-full max-w-6xl gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {summary ? (
            <button
              type="button"
              className="focus-visible:ring-ring rounded-xl text-left outline-none focus-visible:ring-2 lg:hidden"
              onClick={() => setSheetOpen(true)}
            >
              {summary}
            </button>
          ) : null}
          {children}
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-20">{sidebar}</div>
        </aside>
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-80 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{sheetTitle}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">{sidebar}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
