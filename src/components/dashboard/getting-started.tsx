"use client";

import {
  CalendarClockIcon,
  ChevronRightIcon,
  FileUpIcon,
  type LucideIcon,
  PlusIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

function Step({
  icon: Icon,
  title,
  hint,
  href,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="hover:bg-accent focus-visible:ring-ring -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors outline-none focus-visible:ring-2"
      >
        <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-muted-foreground text-sm">{hint}</span>
        </span>
        <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
      </Link>
    </li>
  );
}

/** Replaces the dashboard's empty charts until there is something to chart */
export function GettingStarted({ onAdd }: { onAdd: () => void }) {
  const t = useTranslations("dashboard.start");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button className="self-start" onClick={onAdd}>
          <PlusIcon />
          {t("add")}
        </Button>
        <ul className="flex flex-col">
          <Step
            icon={FileUpIcon}
            title={t("import")}
            hint={t("importHint")}
            href="/settings#import"
          />
          <Step
            icon={WalletIcon}
            title={t("accounts")}
            hint={t("accountsHint")}
            href="/accounts"
          />
          <Step
            icon={CalendarClockIcon}
            title={t("planned")}
            hint={t("plannedHint")}
            href="/planned"
          />
        </ul>
      </CardContent>
    </Card>
  );
}
