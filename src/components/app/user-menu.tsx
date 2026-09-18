"use client";

import {
  ChevronsUpDownIcon,
  LanguagesIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";

import { useSwitchLocale } from "~/components/app/language-switcher";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "~/components/ui/sidebar";
import { isLocale, LOCALES } from "~/i18n/config";
import { authClient } from "~/lib/auth/client";

export type MenuUser = {
  name: string;
  email: string;
  build: { id: string | null; env: string } | null;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

export function UserMenu({ user }: { user: MenuUser }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { isMobile } = useSidebar();
  const { switchLocale } = useSwitchLocale(true);

  const logout = async () => {
    await authClient.signOut();
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-muted-foreground text-xs">
                  {user.email}
                </span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="grid text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-muted-foreground text-xs">
                  {user.email}
                </span>
                {user.build ? (
                  <span className="mt-1 truncate text-muted-foreground text-xs">
                    {t("nav.build", {
                      id: user.build.id ?? t("common.dev"),
                      env: user.build.env,
                    })}
                  </span>
                ) : null}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <LanguagesIcon />
                  {t("common.language")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={locale}
                    onValueChange={(value) => {
                      if (isLocale(value)) {
                        void switchLocale(value);
                      }
                    }}
                  >
                    {LOCALES.map((option) => (
                      <DropdownMenuRadioItem key={option} value={option}>
                        {t(`locales.${option}`)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {theme === "light" ? (
                    <SunIcon />
                  ) : theme === "system" ? (
                    <MonitorIcon />
                  ) : (
                    <MoonIcon />
                  )}
                  {t("common.theme")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={theme ?? "dark"}
                    onValueChange={setTheme}
                  >
                    <DropdownMenuRadioItem value="system">
                      {t("theme.system")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="light">
                      {t("theme.light")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      {t("theme.dark")}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <SettingsIcon />
                  {t("nav.settings")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void logout()}>
              <LogOutIcon />
              {t("nav.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
