"use client";

import { useQuery } from "@tanstack/react-query";
import { Schema, SchemaTransformation } from "effect";
import {
  CalendarClockIcon,
  LayoutDashboardIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
import { type ReactNode, useId, useMemo, useState } from "react";

import { BalancesSidebar } from "~/components/app/balances-sidebar";
import { LedgerLayout } from "~/components/app/ledger-layout";
import {
  ChartSkeleton,
  DashboardSkeleton,
  LoadingRegion,
  NearestSkeleton,
  TableSkeleton,
} from "~/components/app/skeletons";
import { BalanceChart } from "~/components/dashboard/balance-chart";
import { BalanceSummary } from "~/components/dashboard/balance-summary";
import { ForecastTable } from "~/components/dashboard/forecast-table";
import { GettingStarted } from "~/components/dashboard/getting-started";
import { MonthSummary } from "~/components/dashboard/month-summary";
import { NearestPlanned } from "~/components/dashboard/nearest-planned";
import {
  type TransactionDialogState,
  TransactionFormDialog,
} from "~/components/transactions/transaction-form-dialog";
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
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useLocalStorage } from "~/hooks/use-local-storage";
import { usePrimaryCurrency } from "~/hooks/use-primary-currency";
import {
  clampRange,
  RANGE_DEFAULT,
  RANGE_MAX,
  RANGE_MIN,
} from "~/lib/dashboard";
import { useTRPC } from "~/trpc/react";

const parsers = { currency: parseAsString };

const clampedRange = Schema.Finite.pipe(
  Schema.decodeTo(
    Schema.Finite,
    SchemaTransformation.transform({
      decode: clampRange,
      encode: (value: number) => value,
    }),
  ),
);
const rangeSchema = Schema.Struct({ back: clampedRange, ahead: clampedRange });
const RANGE_FALLBACK = { back: RANGE_DEFAULT, ahead: RANGE_DEFAULT };

/** Accounts switched off (so new ones start on) and whether debts count */
const scopeSchema = Schema.Struct({
  excluded: Schema.Array(Schema.String),
  debts: Schema.Boolean,
});
type Scope = typeof scopeSchema.Type;
const SCOPE_FALLBACK: Scope = { excluded: [], debts: true };

function RangeFields({
  back,
  ahead,
  onChange,
}: {
  back: number;
  ahead: number;
  onChange: (value: { back: number; ahead: number }) => void;
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
            onChange({ back, ahead, [key]: next });
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
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{t("range")}</p>
      <p className="text-muted-foreground text-sm">
        {t("rangeHint", { min: RANGE_MIN, max: RANGE_MAX })}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {field("back", back)}
        {field("ahead", ahead)}
      </div>
    </div>
  );
}

/** Which accounts (and whether debts) a card covers, plus any extra fields */
function ScopeOptions({
  accounts,
  scope,
  onChange,
  children,
}: {
  accounts: { id: string; name: string }[];
  scope: Scope;
  onChange: (scope: Scope) => void;
  children?: ReactNode;
}) {
  const t = useTranslations("dashboard.options");
  const id = useId();

  const toggle = (accountId: string, on: boolean) =>
    onChange({
      ...scope,
      excluded: on
        ? scope.excluded.filter((x) => x !== accountId)
        : [...scope.excluded, accountId],
    });

  const row = (
    key: string,
    label: string,
    checked: boolean,
    set: (on: boolean) => void,
  ) => (
    <Field key={key} orientation="horizontal">
      <Switch id={`${id}-${key}`} checked={checked} onCheckedChange={set} />
      <FieldLabel
        htmlFor={`${id}-${key}`}
        className="min-w-0 truncate font-normal"
      >
        {label}
      </FieldLabel>
    </Field>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("title")}>
          <SlidersHorizontalIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle>{t("title")}</PopoverTitle>
        </PopoverHeader>
        {children ? (
          <>
            {children}
            <Separator />
          </>
        ) : null}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t("accounts")}</p>
          <div className="-mx-1 -my-2 flex max-h-72 flex-col gap-2 overflow-y-auto px-1 py-2">
            {accounts.map((account) =>
              row(
                account.id,
                account.name,
                !scope.excluded.includes(account.id),
                (on) => toggle(account.id, on),
              ),
            )}
          </div>
          <Separator />
          {row("debts", t("debts"), scope.debts, (debts) =>
            onChange({ ...scope, debts }),
          )}
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
  const [range, setRange, rangeReady] = useLocalStorage(
    "zm.dashboard.balance.range",
    rangeSchema,
    RANGE_FALLBACK,
  );
  const [balanceScope, setBalanceScope, balanceReady] = useLocalStorage(
    "zm.dashboard.balance.scope",
    scopeSchema,
    SCOPE_FALLBACK,
  );
  const [forecastScope, setForecastScope, forecastReady] = useLocalStorage(
    "zm.dashboard.forecast.scope",
    scopeSchema,
    SCOPE_FALLBACK,
  );

  const accounts = useQuery(trpc.accounts.list.queryOptions());
  const primary = usePrimaryCurrency();

  // currencies of the active accounts: the primary one, then most used first
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

    return [...seen.values()].sort(
      (a, b) =>
        Number(b.id === primary.currencyId) -
        Number(a.id === primary.currencyId),
    );
  }, [accounts.data, primary.currencyId]);

  const currency =
    currencies.find((c) => c.code === state.currency) ?? currencies[0];

  const currencyAccounts = useMemo(
    () =>
      (accounts.data ?? []).filter(
        (account) => account.isActive && account.currencyId === currency?.id,
      ),
    [accounts.data, currency?.id],
  );
  const scopeInput = (scope: Scope) => ({
    currencyId: currency?.id ?? "",
    accountIds: currencyAccounts
      .filter((account) => !scope.excluded.includes(account.id))
      .map((account) => account.id),
    includeDebts: scope.debts,
  });

  const balance = useQuery({
    ...trpc.dashboard.balance.queryOptions({
      ...scopeInput(balanceScope),
      ...range,
    }),
    enabled: !!currency && primary.ready && rangeReady && balanceReady,
  });
  const forecast = useQuery({
    ...trpc.dashboard.forecast.queryOptions(scopeInput(forecastScope)),
    enabled: !!currency && primary.ready && forecastReady,
  });
  const nearest = useQuery(trpc.dashboard.nearest.queryOptions());

  const [dialog, setDialog] = useState<TransactionDialogState>(null);

  const noAccounts = accounts.isSuccess && currencies.length === 0;
  // nothing recorded or planned yet, so there is nothing to chart
  const firstRun =
    accounts.isSuccess &&
    nearest.isSuccess &&
    nearest.data.length === 0 &&
    accounts.data.every((account) => account.usage === 0);

  const currencyTabs = (className: string, listClassName?: string) =>
    currencies.length > 1 && currency ? (
      <Tabs
        className={className}
        value={currency.code}
        onValueChange={(code) => void setState({ currency: code })}
      >
        <TabsList className={listClassName}>
          {currencies.map((c) => (
            <TabsTrigger key={c.id} value={c.code}>
              {c.code}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    ) : null;

  return (
    <LedgerLayout
      title={t("title")}
      // beside the title they would squeeze it on a phone
      filters={currencyTabs("max-sm:hidden")}
      sidebar={<BalancesSidebar />}
      summary={
        currency && !firstRun ? (
          <BalanceSummary
            available={currencyAccounts.reduce(
              (sum, account) => sum + account.balance,
              0,
            )}
            sign={currency.sign}
            currencyId={currency.id}
          />
        ) : null
      }
    >
      {firstRun ? null : currencyTabs("sm:hidden", "w-full")}
      {accounts.isPending ? (
        // which currency to chart is not known yet; the cards hold their place
        <LoadingRegion className="contents">
          <DashboardSkeleton />
        </LoadingRegion>
      ) : noAccounts ? (
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
      ) : firstRun ? (
        <GettingStarted onAdd={() => setDialog({ mode: "create" })} />
      ) : (
        <>
          {currency ? <MonthSummary currencyId={currency.id} /> : null}
          <Card className="gap-2">
            <CardHeader>
              <CardTitle>{t("balance.title")}</CardTitle>
              <CardAction>
                <ScopeOptions
                  accounts={currencyAccounts}
                  scope={balanceScope}
                  onChange={setBalanceScope}
                >
                  <RangeFields
                    back={range.back}
                    ahead={range.ahead}
                    onChange={setRange}
                  />
                </ScopeOptions>
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
                <LoadingRegion>
                  <ChartSkeleton />
                </LoadingRegion>
              )}
            </CardContent>
          </Card>

          <Card className="gap-2">
            <CardHeader>
              <CardTitle>{t("forecast.title")}</CardTitle>
              <CardAction>
                <ScopeOptions
                  accounts={currencyAccounts}
                  scope={forecastScope}
                  onChange={setForecastScope}
                />
              </CardAction>
            </CardHeader>
            <CardContent>
              {forecast.data ? (
                <ForecastTable months={forecast.data} today={today} />
              ) : (
                <LoadingRegion>
                  <TableSkeleton rows={4} columns={4} />
                </LoadingRegion>
              )}
            </CardContent>
          </Card>

          <Card className="gap-2">
            <CardHeader>
              <CardTitle>{t("nearest.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {nearest.isPending ? (
                <LoadingRegion>
                  <NearestSkeleton />
                </LoadingRegion>
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

      <TransactionFormDialog state={dialog} onClose={() => setDialog(null)} />
    </LedgerLayout>
  );
}
