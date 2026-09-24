"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Logo } from "~/components/app/logo";
import { NAV_ITEMS, type QuickAddKey } from "~/components/app/nav-items";
import { QuickAddDialogs } from "~/components/app/quick-add-dialogs";
import { type MenuUser, UserMenu } from "~/components/app/user-menu";
import { Badge } from "~/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "~/components/ui/sidebar";
import { HOME_PATH } from "~/lib/auth-routing";

export function AppSidebar({
  user,
  isAdmin,
  isDevBuild,
}: {
  user: MenuUser;
  isAdmin: boolean;
  isDevBuild: boolean;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const [quickAdd, setQuickAdd] = useState<QuickAddKey | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const openQuickAdd = (key: QuickAddKey) => {
    setOpenMobile(false);
    setQuickAdd(key);
    setQuickAddOpen(true);
  };

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link href={HOME_PATH}>
                  <Logo className="shrink-0" />
                  <span className="font-semibold group-data-[collapsible=icon]:hidden">
                    {t("common.appName")}
                  </span>
                  {isDevBuild ? (
                    <Badge
                      variant="outline"
                      className="ml-auto group-data-[collapsible=icon]:hidden"
                    >
                      {t("common.dev")}
                    </Badge>
                  ) : null}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map(
                  (item) => (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname.startsWith(item.href)}
                        className="data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground data-active:hover:bg-sidebar-primary/90 data-active:hover:text-sidebar-primary-foreground"
                        tooltip={t(`nav.${item.key}`)}
                      >
                        <Link
                          href={item.href}
                          onClick={() => setOpenMobile(false)}
                        >
                          <item.icon />
                          <span>{t(`nav.${item.key}`)}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.quickAdd ? (
                        <SidebarMenuAction
                          aria-label={t(`${item.key}.add`)}
                          title={t(`${item.key}.add`)}
                          className="peer-data-active/menu-button:text-sidebar-primary-foreground peer-data-active/menu-button:hover:bg-sidebar-primary-foreground/15 peer-data-active/menu-button:hover:text-sidebar-primary-foreground"
                          onClick={() => openQuickAdd(item.key)}
                        >
                          <PlusIcon />
                        </SidebarMenuAction>
                      ) : null}
                    </SidebarMenuItem>
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <UserMenu user={user} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      {/* outside the sidebar: on phones it is a sheet that unmounts on close */}
      <QuickAddDialogs
        kind={quickAdd}
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
      />
    </>
  );
}
