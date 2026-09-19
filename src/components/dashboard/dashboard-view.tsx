"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CalendarClockIcon,
  LayoutDashboardIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useId, useMemo } from "react";

import { PageHeader } from "~/components/app/page-header";
import { BalanceChart } from "~/components/dashboard/balance-chart";
import { ForecastTable } from "~/components/dashboard/forecast-table";
import { NearestPlanned } from "~/components/dashboard/nearest-planned";
import { useToday } from "~/components/transactions/transaction-groups";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  clampRange,
  RANGE_DEFAULT,
  RANGE_MAX,
  RANGE_MIN,
} from "~/lib/dashboard";
import { useTRPC } from "~/trpc/react";

const parsers = {
  currency: parseAsString,
  back: parseAsInteger.withDefault(RANGE_DEFAULT),
  ahead: parseAsInteger.withDefault(RANGE_DEFAULT),
};

function RangePopover({
  back,
  ahead,
  onChange,
}: {
  back: number;
  ahead: number;
  onChange: (value: { back?: number; ahead?: number }) => void;
}) {
  const t = useTranslations("dashboard.balance");
  const id = useId();

  const field = (key: "back" | "ahead", value: number) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-${key}`}>{t(key)}</Label>
      <Input
        // remount on outside changes so the field shows the clamped value
        key={value}
        id={`${id}-${key}`}
        type="number"
        inputMode="numeric"
        min={RANGE_MIN}
        max={RANGE_MAX}
        defaultValue={value}
        onBlur={(event) => {
          const next = clampRange(Number(event.target.value));

          event.target.value = String(next);
          if (next !== value) {
            onChange({ [key]: next });
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("range")}>
          <SlidersHorizontalIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle>{t("range")}</PopoverTitle>
          <PopoverDescription>
            {t("rangeHint", { min: RANGE_MIN, max: RANGE_MAX })}
          </PopoverDescription>
        </PopoverHeader>
        <div className="grid grid-cols-2 gap-3">
          {field("back", back)}
          {field("ahead", ahead)}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DashboardView() {
  const t = useTranslations("dashboard");
  const trpc = useTRPC();
  const today = useToday();
  const [state, setState] = useQueryStates(parsers);
  const back = clampRange(state.back);
  const ahead = clampRange(state.ahead);

  const accounts = useQuery(trpc.accounts.list.queryOptions());

  // currencies of the active accounts, most used first (the list's order)
  const currencies = useMemo(() => {
    const seen = new Map<string, { id: string; code: string; sign: string }>();

    for (const account of accounts.data ?? []) {
      if (account.isActive && !seen.has(account.currencyId)) {
        seen.set(account.currencyId, {
          id: account.currencyId,
          code: account.currencyCode,
          sign: account.currencySign,
        });
      }
    }

    return [...seen.values()];
  }, [accounts.data]);

  const currency =
    currencies.find((c) => c.code === state.currency) ?? currencies[0];

  const balance = useQuery({
    ...trpc.dashboard.balance.queryOptions({
      currencyId: currency?.id ?? "",
      back,
      ahead,
    }),
    enabled: !!currency,
  });
  const forecast = useQuery({
    ...trpc.dashboard.forecast.queryOptions({ currencyId: currency?.id ?? "" }),
    enabled: !!currency,
  });
  const nearest = useQuery(trpc.dashboard.nearest.queryOptions());

  const noAccounts = accounts.isSuccess && currencies.length === 0;

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          currencies.length > 1 && currency ? (
            <Tabs
              value={currency.code}
              onValueChange={(code) => void setState({ currency: code })}
            >
              <TabsList>
                {currencies.map((c) => (
                  <TabsTrigger key={c.id} value={c.code}>
                    {c.code}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null
        }
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
        {noAccounts ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutDashboardIcon />
              </EmptyMedia>
              <EmptyDescription>{t("noAccounts")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href="/accounts">{t("createAccount")}</Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <Card className="gap-2">
              <CardHeader>
                <CardTitle>{t("balance.title")}</CardTitle>
                <CardAction>
                  <RangePopover
                    back={back}
                    ahead={ahead}
                    onChange={(value) => void setState(value)}
                  />
                </CardAction>
              </CardHeader>
              <CardContent className="px-2 sm:px-6">
                {balance.data && currency ? (
                  <BalanceChart
                    points={balance.data}
                    today={today}
                    sign={currency.sign}
                  />
                ) : (
                  <Skeleton className="h-56 w-full sm:h-80" />
                )}
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>{t("forecast.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                {forecast.data ? (
                  <ForecastTable months={forecast.data} today={today} />
                ) : (
                  <Skeleton className="h-32 w-full" />
                )}
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardHeader>
                <CardTitle>{t("nearest.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                {nearest.isPending ? (
                  <Skeleton className="h-32 w-full" />
                ) : nearest.data && nearest.data.length > 0 ? (
                  <NearestPlanned days={nearest.data} today={today} />
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <CalendarClockIcon />
                      </EmptyMedia>
                      <EmptyDescription>{t("nearest.empty")}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
