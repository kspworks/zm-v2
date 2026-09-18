import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";

export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Empty>
        <EmptyHeader>
          <p className="font-semibold text-5xl text-muted-foreground tabular-nums">
            404
          </p>
          <EmptyTitle>{t("title")}</EmptyTitle>
          <EmptyDescription>{t("description")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href="/transactions">{t("home")}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}
