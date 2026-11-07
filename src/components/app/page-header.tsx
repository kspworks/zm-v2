import type { ReactNode } from "react";

import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";

/** The sticky top bar of every signed-in page: menu trigger, title, actions */
export function PageHeader({
  title,
  actions,
}: {
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1 max-md:hidden" />
      <Separator
        orientation="vertical"
        className="mr-1 data-vertical:self-center data-[orientation=vertical]:h-4 max-md:hidden"
      />
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
        {title}
      </h1>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
