"use client";

import {
  ArrowLeftRightIcon,
  ChartPieIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MenuIcon,
  PlusIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { NavIcon } from "~/components/app/nav-icon";
import { useSidebar } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

const TAB =
  "flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] leading-none font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring";

const tabTone = (active: boolean) =>
  active ? "text-primary dark:text-sky-400" : "text-muted-foreground";

function TabLink({
  href,
  match,
  icon,
  label,
}: {
  href: string;
  match: string;
  icon: LucideIcon;
  label: string;
}) {
  const active = usePathname().startsWith(match);

  return (
    <li className="min-w-0">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(TAB, tabTone(active))}
      >
        <NavIcon icon={icon} className="size-5 shrink-0" />
        <span className="max-w-full truncate">{label}</span>
      </Link>
    </li>
  );
}

/**
 * Phone navigation: the pages used daily and Add within thumb reach. Everything
 * else stays in the sidebar sheet behind Menu.
 */
export function BottomNav({ onAdd }: { onAdd: () => void }) {
  const t = useTranslations();
  const pathname = usePathname();
  const { openMobile, setOpenMobile } = useSidebar();
  const elsewhere = !["/dashboard", "/transactions", "/reports"].some((path) =>
    pathname.startsWith(path),
  );

  return (
    <nav
      aria-label={t("nav.primary")}
      className="bg-background/95 supports-backdrop-filter:bg-background/80 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid h-14 grid-cols-5 items-center">
        <TabLink
          href="/dashboard"
          match="/dashboard"
          icon={LayoutDashboardIcon}
          label={t("nav.dashboard")}
        />
        <TabLink
          href="/transactions"
          match="/transactions"
          icon={ArrowLeftRightIcon}
          label={t("nav.transactions")}
        />
        <li className="flex justify-center">
          <button
            type="button"
            aria-label={t("transactions.add")}
            onClick={onAdd}
            className="bg-primary text-primary-foreground focus-visible:ring-ring flex size-12 items-center justify-center rounded-full shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <PlusIcon className="size-6" />
          </button>
        </li>
        <TabLink
          href="/reports/map"
          match="/reports"
          icon={ChartPieIcon}
          label={t("nav.reports")}
        />
        <li className="min-w-0">
          <button
            type="button"
            aria-expanded={openMobile}
            onClick={() => setOpenMobile(true)}
            className={cn(TAB, "w-full", tabTone(elsewhere))}
          >
            <MenuIcon className="size-5 shrink-0" />
            <span className="max-w-full truncate">{t("nav.menu")}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
