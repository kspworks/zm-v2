"use client";

import type { LucideIcon } from "lucide-react";
import { useLinkStatus } from "next/link";
import { useTranslations } from "next-intl";

import { Spinner } from "~/components/ui/spinner";

/**
 * A nav item's icon, swapped for a spinner while its link is pending, so the
 * click is acknowledged before the page arrives. Must render inside the Link.
 */
export function NavIcon({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  const t = useTranslations();
  const { pending } = useLinkStatus();

  return pending ? (
    <Spinner aria-label={t("common.loading")} className={className} />
  ) : (
    <Icon className={className} />
  );
}
