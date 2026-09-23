"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

const TABS = [
  { href: "/reports", label: "map" },
  { href: "/reports/compare", label: "comparison" },
] as const;

/**
 * The Reports sub-pages as tabs. Each is its own route; the links keep the
 * query string, so the filters carry over between them.
 */
export function ReportsTabs() {
  const t = useTranslations("reports");
  const pathname = usePathname();
  const search = useSearchParams().toString();

  return (
    <Tabs value={pathname}>
      <TabsList variant="line">
        {TABS.map((tab) => (
          <TabsTrigger key={tab.href} value={tab.href} asChild>
            <Link href={search ? `${tab.href}?${search}` : tab.href}>
              {t(tab.label)}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
