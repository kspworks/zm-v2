"use client";

import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex min-h-[60svh] items-center justify-center p-4">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("errorPage.title")}</EmptyTitle>
          <EmptyDescription>{t("errorPage.description")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={reset}>{t("common.retry")}</Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}
