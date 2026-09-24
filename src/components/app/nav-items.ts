import {
  ArrowLeftRightIcon,
  CalendarClockIcon,
  ChartPieIcon,
  FolderTreeIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  UsersIcon,
  UsersRoundIcon,
  WalletIcon,
} from "lucide-react";

export type NavKey =
  | "dashboard"
  | "transactions"
  | "planned"
  | "reports"
  | "accounts"
  | "categories"
  | "counterparties"
  | "users";

/** Items whose sidebar entry carries a "+" that opens the page's create dialog */
export type QuickAddKey = Extract<
  NavKey,
  "transactions" | "planned" | "accounts" | "categories"
>;

type NavItem = {
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
} & (
  | { key: QuickAddKey; quickAdd?: true }
  | { key: Exclude<NavKey, QuickAddKey>; quickAdd?: never }
);

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  {
    key: "transactions",
    href: "/transactions",
    icon: ArrowLeftRightIcon,
    quickAdd: true,
  },
  { key: "planned", href: "/planned", icon: CalendarClockIcon, quickAdd: true },
  { key: "reports", href: "/reports", icon: ChartPieIcon },
  { key: "accounts", href: "/accounts", icon: WalletIcon, quickAdd: true },
  {
    key: "categories",
    href: "/categories",
    icon: FolderTreeIcon,
    quickAdd: true,
  },
  { key: "counterparties", href: "/counterparties", icon: UsersRoundIcon },
  { key: "users", href: "/users", icon: UsersIcon, adminOnly: true },
];
