"use client";

import { useMutation } from "@tanstack/react-query";
import { LanguagesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { isLocale, LOCALES, type Locale } from "~/i18n/config";
import { writeLocaleCookie } from "~/lib/locale-cookie";
import { useTRPC } from "~/trpc/react";

/** Hook for any locale control: cookie, profile (when signed in), re-render */
export const useSwitchLocale = (signedIn: boolean) => {
  const router = useRouter();
  const trpc = useTRPC();
  const [pending, startTransition] = useTransition();
  const setProfileLocale = useMutation(trpc.me.setLocale.mutationOptions());

  const switchLocale = async (locale: Locale) => {
    writeLocaleCookie(locale);

    if (signedIn) {
      await setProfileLocale.mutateAsync({ locale }).catch(() => undefined);
    }

    startTransition(() => router.refresh());
  };

  return { switchLocale, pending };
};

/** The compact switcher for the public auth pages */
export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations();
  const { switchLocale, pending } = useSwitchLocale(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending}>
          <LanguagesIcon />
          {t(`locales.${locale}`)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
