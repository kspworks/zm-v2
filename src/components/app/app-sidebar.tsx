"use client";

import { ChevronRightIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentProps, type ReactNode, Suspense, useState } from "react";

import { Logo } from "~/components/app/logo";
import {
  NAV_ITEMS,
  type NavSubItem,
  type QuickAddKey,
} from "~/components/app/nav-items";
import { QuickAddDialogs } from "~/components/app/quick-add-dialogs";
import { type MenuUser, UserMenu } from "~/components/app/user-menu";
import { Badge } from "~/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "~/components/ui/sidebar";
import { HOME_PATH } from "~/lib/auth-routing";

const ACTIVE_BUTTON =
  "data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground data-active:hover:bg-sidebar-primary/90 data-active:hover:text-sidebar-primary-foreground";

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
  const { setOpenMobile, state, isMobile } = useSidebar();
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
                  (item) =>
                    item.items ? (
                      <NavGroup
                        key={item.key}
                        label={t(`nav.${item.key}`)}
                        icon={<item.icon />}
                        items={item.items}
                        isActive={pathname.startsWith(item.href)}
                        // icon-only: sub-items have no room, so they pop out
                        asMenu={state === "collapsed" && !isMobile}
                        onNavigate={() => setOpenMobile(false)}
                      />
                    ) : (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton
                          asChild
                          isActive={pathname.startsWith(item.href)}
                          className={ACTIVE_BUTTON}
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

/**
 * A nav item that only groups sub-pages: it expands them in place, or, when
 * the sidebar is collapsed to icons, opens them as a menu beside it.
 */
function NavGroup({
  label,
  icon,
  items,
  isActive,
  asMenu,
  onNavigate,
}: {
  label: string;
  icon: ReactNode;
  items: NavSubItem[];
  isActive: boolean;
  asMenu: boolean;
  onNavigate: () => void;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(isActive);
  const [wasActive, setWasActive] = useState(isActive);

  // arriving on one of its pages by any route opens the group
  if (isActive !== wasActive) {
    setWasActive(isActive);
    if (isActive) {
      setOpen(true);
    }
  }

  if (asMenu) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              isActive={isActive}
              className={ACTIVE_BUTTON}
              aria-label={label}
            >
              {icon}
              <span>{label}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="min-w-48">
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            {items.map((sub) => (
              <DropdownMenuItem key={sub.href} asChild>
                <SubLink href={sub.href} onClick={onNavigate}>
                  {t(sub.label)}
                </SubLink>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible
      asChild
      open={open}
      onOpenChange={setOpen}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={isActive} className={ACTIVE_BUTTON}>
            {icon}
            <span>{label}</span>
            <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((sub) => (
              <SidebarMenuSubItem key={sub.href}>
                <SidebarMenuSubButton
                  asChild
                  isActive={pathname.startsWith(sub.href)}
                  className={ACTIVE_BUTTON}
                >
                  <SubLink href={sub.href} onClick={onNavigate}>
                    <span>{t(sub.label)}</span>
                  </SubLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

type SubLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
};

/**
 * Between sibling sub-pages the query string comes along, so the filters
 * carry over. Reading it needs a Suspense boundary; until then, a plain link.
 */
function SubLink(props: SubLinkProps) {
  return (
    <Suspense fallback={<Link {...props} />}>
      <SiblingLink {...props} />
    </Suspense>
  );
}

function SiblingLink({ href, ...props }: SubLinkProps) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const group = href.slice(0, href.lastIndexOf("/"));
  const sibling = search && pathname.startsWith(`${group}/`);

  return <Link href={sibling ? `${href}?${search}` : href} {...props} />;
}
