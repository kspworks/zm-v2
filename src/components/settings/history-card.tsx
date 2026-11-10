"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { HistoryIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Money } from "~/components/app/money";
import { HistoryListSkeleton, LoadingRegion } from "~/components/app/skeletons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { useDateTime } from "~/hooks/use-date-time";
import { useTRPC } from "~/trpc/react";

/** What this user changed, newest first, read from the audit log */
export function HistoryCard() {
  const t = useTranslations("history");
  const dateTime = useDateTime();
  const trpc = useTRPC();
  const list = useInfiniteQuery(
    trpc.history.list.infiniteQueryOptions(
      {},
      { getNextPageParam: (page) => page.nextCursor },
    ),
  );
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card id="history">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {list.isPending ? (
          <LoadingRegion>
            <HistoryListSkeleton />
          </LoadingRegion>
        ) : items.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HistoryIcon />
              </EmptyMedia>
              <EmptyDescription>{t("empty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex items-start justify-between gap-3 py-2.5 text-sm"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={
                        item.action === "delete" ? "destructive" : "secondary"
                      }
                    >
                      {t(`actions.${item.action}`)}
                    </Badge>
                    <span className="text-muted-foreground">
                      {t(`types.${item.entityType}`)}
                    </span>
                    {item.count > 1 ? (
                      <span className="text-muted-foreground">
                        {t("count", { count: item.count })}
                      </span>
                    ) : null}
                  </div>
                  {item.label ? (
                    <span className="truncate">{item.label}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {item.amount !== null && item.count === 1 ? (
                    <Money
                      amount={item.amount}
                      sign={item.sign}
                      className="font-medium"
                    />
                  ) : null}
                  <time
                    dateTime={item.at.toISOString()}
                    className="text-muted-foreground text-xs"
                  >
                    {dateTime(item.at)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage ? (
          <Button
            variant="outline"
            className="self-center"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? <Spinner /> : null}
            {t("more")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
