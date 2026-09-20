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

export const NAV_ITEMS: {
  key: NavKey;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { key: "transactions", href: "/transactions", icon: ArrowLeftRightIcon },
  { key: "planned", href: "/planned", icon: CalendarClockIcon },
  { key: "reports", href: "/reports", icon: ChartPieIcon },
  { key: "accounts", href: "/accounts", icon: WalletIcon },
  { key: "categories", href: "/categories", icon: FolderTreeIcon },
  { key: "counterparties", href: "/counterparties", icon: UsersRoundIcon },
  { key: "users", href: "/users", icon: UsersIcon, adminOnly: true },
];
