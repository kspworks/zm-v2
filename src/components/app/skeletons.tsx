import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";

import { PageHeader } from "~/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

/*
 * The loading states of the signed-in pages. Each one outlines the layout it
 * stands in for, so nothing moves when the data lands. A route's `loading.tsx`
 * and the view's own pending branch render the same components: a navigation
 * passes through both, and they must not differ.
 *
 * No "use client" here, so server and client components can both import it.
 * Widths come from fixed patterns, never from chance, so server and client
 * agree. The class lists repeat those of the components they mirror; change
 * them together.
 */

/** Announces the wait once; the blocks inside are hidden from screen readers */
export function LoadingRegion({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("common");

  return (
    <div role="status" className={className}>
      <span className="sr-only">{t("loading")}</span>
      {children}
    </div>
  );
}

const LINES = {
  xs: ["h-4", "h-2.5"],
  sm: ["h-5", "h-3"],
  base: ["h-6", "h-3.5"],
  lg: ["h-7", "h-4"],
  "2xl": ["h-8", "h-5"],
} as const;

/**
 * A line of text: a bar centred in a box as tall as that text's line, so a
 * row of them is exactly as high as the row it stands in for.
 */
function Line({
  size = "sm",
  w,
  className,
}: {
  size?: keyof typeof LINES;
  /** The bar's width, a Tailwind class */
  w: string;
  className?: string;
}) {
  const [box, bar] = LINES[size];

  return (
    <div className={cn("flex min-w-0 items-center", box, className)}>
      <Skeleton className={cn("max-w-full rounded-sm", bar, w)} />
    </div>
  );
}

/** The pattern's entry for a row, going round when the rows outnumber it */
type Pattern<T> = readonly [T, ...T[]];

const pick = <T,>(pattern: Pattern<T>, index: number): T =>
  pattern[index % pattern.length] ?? pattern[0];

/** Room for a row's "more" button, which sets the row's height */
const MENU = "size-7 touch:size-11 shrink-0";

/** Fades a list out towards its end: more is coming, not exactly N rows */
const TAIL = "mask-b-from-45%";

/* ---------------------------------------------------------------- lists */

type RowWidths = { title: string; comment?: string; account: string };

const TRANSACTION_DAYS: RowWidths[][] = [
  [
    { title: "w-28", comment: "w-44", account: "w-16" },
    { title: "w-40", account: "w-20" },
    { title: "w-24", comment: "w-28", account: "w-14" },
  ],
  [{ title: "w-36", comment: "w-56", account: "w-20" }],
  [
    { title: "w-32", account: "w-16" },
    { title: "w-20", comment: "w-36", account: "w-24" },
  ],
];

/** Mirrors `TransactionGroups` and `TransactionItem` */
export function TransactionListSkeleton() {
  return (
    <div className="@container">
      <div className={cn("flex flex-col @2xl:gap-1.5", TAIL)}>
        {TRANSACTION_DAYS.map((rows, day) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
            key={day}
            className="@2xl:grid @2xl:grid-cols-[8.5rem_minmax(0,1fr)] @2xl:items-start @2xl:gap-x-3"
          >
            <div className="flex items-center gap-2 @max-2xl:px-3 @max-2xl:pt-4 @max-2xl:pb-1.5 @max-2xl:sm:px-4 @max-2xl:md:pt-2.5 @max-2xl:md:pb-1 @2xl:h-0 @2xl:flex-col @2xl:items-start @2xl:gap-0 @2xl:pt-1.5 @2xl:pl-1">
              <Line w="w-16" />
              <Line size="xs" w="w-12" />
            </div>
            <div className="bg-card divide-y overflow-hidden rounded-lg border">
              {rows.map((row, index) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
                  key={index}
                  className="flex items-start gap-3 px-3 py-2.5 sm:px-4 md:items-center md:py-1"
                >
                  <div className="min-w-0 flex-1 md:flex md:items-center md:gap-3">
                    <Line w={row.title} className="md:shrink-0" />
                    <div className="flex min-w-0 items-center gap-x-3 md:contents">
                      {row.comment ? (
                        <Line w={row.comment} className="md:flex-1" />
                      ) : null}
                      <Line
                        size="xs"
                        w={row.account}
                        className="max-md:h-5 md:ml-auto md:shrink-0"
                      />
                    </div>
                  </div>
                  <Line w="w-16" className="shrink-0 justify-end md:min-w-28" />
                  <div className={cn(MENU, "-mr-2")} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const ITEM_WIDTHS: Pattern<readonly [string, string]> = [
  ["w-32", "w-52"],
  ["w-44", "w-40"],
  ["w-28", "w-56"],
  ["w-36", "w-44"],
] as const;

/**
 * Mirrors an `ItemGroup` of outlined `Item`s: a title over a description, a
 * value and a menu at the end. Accounts, counterparties, people, invites,
 * imports and the members of a shared entity all have this shape.
 */
export function ItemListSkeleton({
  rows = 4,
  icon = false,
  value = true,
  menu = true,
  fade = true,
}: {
  rows?: number;
  icon?: boolean;
  value?: boolean;
  menu?: boolean;
  fade?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-2", fade && TAIL)}>
      {Array.from({ length: rows }, (_, index) => {
        const [title, description] = pick(ITEM_WIDTHS, index);

        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
            key={index}
            className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
          >
            {icon ? (
              <Skeleton className="size-4 translate-y-0.5 self-start rounded-sm" />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Line w={title} />
              <Line w={description} />
            </div>
            {value ? <Line w="w-20" className="shrink-0" /> : null}
            {menu ? <div className={MENU} /> : null}
          </div>
        );
      })}
    </div>
  );
}

const CATEGORY_ROWS = [
  { name: "w-28", child: false },
  { name: "w-24", child: true },
  { name: "w-36", child: true },
  { name: "w-32", child: false },
  { name: "w-20", child: false },
  { name: "w-28", child: true },
  { name: "w-40", child: false },
] as const;

/** Mirrors the categories tree: one card, a row per category */
export function CategoryListSkeleton() {
  return (
    <div
      className={cn("bg-card divide-y overflow-hidden rounded-lg border", TAIL)}
    >
      {CATEGORY_ROWS.map((row, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
          key={index}
          className={cn(
            "flex items-center gap-2.5 px-3 py-1.5",
            row.child && "pl-9 sm:pl-11",
          )}
        >
          <Skeleton
            className={cn(
              "shrink-0 rounded-sm",
              row.child ? "size-3.5" : "size-2.5",
            )}
          />
          <Line w={row.name} className="flex-1" />
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          <div className={MENU} />
        </div>
      ))}
    </div>
  );
}

const BUDGET_ROWS: Pattern<readonly [string, string]> = [
  ["w-28", "w-3/5"],
  ["w-36", "w-1/3"],
  ["w-24", "w-4/5"],
] as const;

/** Mirrors `BudgetProgress`: a name and amounts, the meter, what is left */
export function BudgetLinesSkeleton({ index = 0 }: { index?: number }) {
  const [name, spent] = pick(BUDGET_ROWS, index);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Line w={name} />
        <Line w="w-28" className="shrink-0" />
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <Skeleton className={cn("h-full rounded-full", spent)} />
      </div>
      <Line size="xs" w="w-24" />
    </div>
  );
}

export function BudgetListSkeleton() {
  return (
    <div className="bg-card divide-y rounded-lg border">
      {BUDGET_ROWS.map((_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
          key={index}
          className="flex items-center gap-3 px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <BudgetLinesSkeleton index={index} />
          </div>
          <div className={MENU} />
        </div>
      ))}
    </div>
  );
}

const HISTORY_ROWS = ["w-40", "w-56", "w-32", "w-48"] as const;

/** Mirrors the change history: what happened on the left, when on the right */
export function HistoryListSkeleton() {
  return (
    <div className={cn("divide-y", TAIL)}>
      {HISTORY_ROWS.map((label, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
          key={index}
          className="flex items-start justify-between gap-3 py-2.5"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Line w="w-20" />
            </div>
            <Line w={label} />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Line w="w-16" />
            <Line size="xs" w="w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

const TABLE_WIDTHS: Pattern<string> = [
  "w-28",
  "w-36",
  "w-24",
  "w-32",
  "w-20",
  "w-40",
] as const;

/** Rows of a table: a name that gives way, then right-aligned numbers */
export function TableSkeleton({
  rows,
  columns,
  className,
}: {
  rows: number;
  /** How many number columns follow the name */
  columns: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {Array.from({ length: rows }, (_, row) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
          key={row}
          className="flex h-10 items-center gap-4 border-b px-2 last:border-0"
        >
          <Line w={pick(TABLE_WIDTHS, row)} className="flex-1" />
          {Array.from({ length: columns }, (_, column) => (
            <Line
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
              key={column}
              w={(row + column) % 3 === 0 ? "w-12" : "w-16"}
              className={cn(
                "w-20 shrink-0 justify-end",
                // a phone has room for two of them
                column > 1 && "max-sm:hidden",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A form that is waiting for its values: labels over inputs */
export function FormSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: fields }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
        <div key={index} className="flex flex-col gap-2">
          <Line w={index % 2 ? "w-28" : "w-20"} />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Mirrors `TotalsBar` with one currency: the column names, then the sums */
export function TotalsSkeleton() {
  return (
    <div className="bg-muted/40 flex flex-col gap-1 rounded-lg border px-3 py-2.5 sm:px-4">
      <div className="grid grid-cols-4 gap-x-4">
        <span />
        <Line size="xs" w="w-14" />
        <Line size="xs" w="w-12" />
        <Line size="xs" w="w-10" />
      </div>
      <div className="grid grid-cols-4 gap-x-4">
        <Line w="w-8" />
        <Line w="w-16" />
        <Line w="w-16" />
        <Line w="w-20" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------- balances sidebar */

const ACCOUNT_ROWS = ["w-24", "w-32", "w-20", "w-28"] as const;

/** Mirrors `BalancesSidebar`: its headings are real, the money is not yet */
export function BalancesSkeleton() {
  const t = useTranslations("sidebar");
  const heading =
    "text-muted-foreground text-xs font-medium tracking-wide uppercase";

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1.5">
        <h3 className={heading}>{t("available")}</h3>
        <Line size="lg" w="w-32" />
      </section>
      <Separator />
      <section className="flex flex-col gap-1.5">
        <h3 className={heading}>{t("accounts")}</h3>
        <div className={cn("flex flex-col", TAIL)}>
          {ACCOUNT_ROWS.map((name, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
              key={index}
              className="touch:min-h-11 flex items-center gap-2 py-1.5"
            >
              <Line w={name} className="flex-1" />
              <Line w="w-16" className="shrink-0" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ----------------------------------------------------------------- charts */

const AREA_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 40' preserveAspectRatio='none'><path d='M0,27 C8,25 14,30 24,25 S40,13 52,17 S68,27 80,15 S94,9 100,11 L100,40 L0,40 Z'/></svg>",
)}")`;

const AREA_STYLE: CSSProperties = {
  maskImage: AREA_MASK,
  maskSize: "100% 100%",
  maskRepeat: "no-repeat",
  WebkitMaskImage: AREA_MASK,
  WebkitMaskSize: "100% 100%",
  WebkitMaskRepeat: "no-repeat",
};

/** Mirrors `BalanceChart`: the legend, then the plot as a quiet silhouette */
export function ChartSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-4">
        <Line size="xs" w="w-20" />
        <Line size="xs" w="w-24" />
      </div>
      <div className="relative h-56 w-full sm:h-80">
        <div className="absolute inset-0 flex flex-col justify-between pb-px">
          {[0, 1, 2, 3, 4].map((line) => (
            <div key={line} className="border-t border-dashed" />
          ))}
        </div>
        <Skeleton
          className="absolute inset-0 rounded-none"
          style={AREA_STYLE}
        />
      </div>
    </div>
  );
}

/** Mirrors `ReportTreemap`: a few tiles of the sizes a report tends to have */
export function TreemapSkeleton() {
  const tile = "rounded-sm";

  return (
    <div className="grid h-[360px] grid-flow-dense grid-cols-12 grid-rows-6 gap-0.5">
      <Skeleton
        className={cn(tile, "col-span-6 row-span-6 max-sm:col-span-7")}
      />
      <Skeleton
        className={cn(tile, "col-span-4 row-span-3 max-sm:col-span-5")}
      />
      <Skeleton className={cn(tile, "col-span-2 row-span-3 max-sm:hidden")} />
      <Skeleton className={cn(tile, "col-span-3 row-span-3")} />
      <Skeleton
        className={cn(tile, "col-span-3 row-span-2 max-sm:col-span-2")}
      />
      <Skeleton className={cn(tile, "col-span-2 row-span-1 max-sm:hidden")} />
      <Skeleton
        className={cn(tile, "col-span-1 row-span-1 max-sm:col-span-2")}
      />
    </div>
  );
}

/** Mirrors the three figures of the month card */
export function StatsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {["w-14", "w-16", "w-12"].map((label) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5">
          <Line size="xs" w={label} />
          <Line size="lg" w="w-24" />
          <Line size="xs" w="w-16" />
        </div>
      ))}
    </div>
  );
}

/** Mirrors the upcoming days: a column per day from md up, a list below it */
export function NearestSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-4 md:gap-6">
      {[2, 1, 3, 1].map((items, day) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
          key={day}
          className={cn("flex flex-col", day > 1 && "max-md:hidden")}
        >
          <div className="flex gap-2 md:flex-col md:gap-0 md:border-b md:pb-2">
            <Line w="w-14" />
            <Line size="xs" w="w-16" className="max-md:h-5" />
          </div>
          {Array.from({ length: items }, (_, item) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pattern
              key={item}
              className="flex items-center justify-between gap-2 md:border-b md:py-2"
            >
              <Line w={item % 2 ? "w-16" : "w-24"} />
              <Line w="w-12" className="shrink-0" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ pages */

/** A header button that is on its way; `wide` ones carry a label from sm up */
export function HeaderButtonSkeleton({
  wide = false,
  className,
}: {
  wide?: boolean;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn(
        "touch:h-11 touch:min-w-11 h-7 w-7",
        wide && "sm:w-24",
        className,
      )}
    />
  );
}

type PageProps = {
  title: ReactNode;
  /** Placeholders for the header's buttons */
  actions?: ReactNode;
  children: ReactNode;
};

/** The frame of the list pages: a narrow column under the header */
export function NarrowPageSkeleton({ title, actions, children }: PageProps) {
  return (
    <>
      <PageHeader title={title} actions={actions} />
      <LoadingRegion className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
        {children}
      </LoadingRegion>
    </>
  );
}

/** The frame of the report pages: one wide column */
export function WidePageSkeleton({ title, actions, children }: PageProps) {
  return (
    <>
      <PageHeader title={title} actions={actions} />
      <LoadingRegion className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
        {children}
      </LoadingRegion>
    </>
  );
}

/** Mirrors `LedgerLayout`: the content, and the balances beside it from lg up */
export function LedgerPageSkeleton({ title, actions, children }: PageProps) {
  return (
    <>
      <PageHeader title={title} actions={actions} />
      <LoadingRegion className="mx-auto grid w-full max-w-6xl gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
        <aside className="hidden lg:block">
          <div className="sticky top-20">
            <BalancesSkeleton />
          </div>
        </aside>
      </LoadingRegion>
    </>
  );
}

/** The search field above the ledger lists */
export function SearchSkeleton() {
  return <Skeleton className="touch:h-11 h-8 w-full rounded-lg" />;
}

/** The tab strip above a page's content, before its tabs are known */
export function TabsSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton className={cn("touch:h-13 h-8 w-44 rounded-lg", className)} />
  );
}

/** The phone-width headline of the dashboard: available money */
export function BalanceSummarySkeleton() {
  const t = useTranslations("sidebar");

  return (
    <div className="bg-card ring-foreground/10 flex items-center gap-3 rounded-xl p-4 ring-1 lg:hidden">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("available")}
        </span>
        <Line size="2xl" w="w-40" />
      </div>
    </div>
  );
}

/** The month card with its figures still to come */
export function MonthCardSkeleton() {
  const t = useTranslations("dashboard.month");

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <Line w="w-48" />
      </CardHeader>
      <CardContent>
        <StatsSkeleton />
      </CardContent>
    </Card>
  );
}

/** The dashboard before it knows the user's accounts and currencies */
export function DashboardSkeleton() {
  const t = useTranslations("dashboard");

  return (
    <>
      <BalanceSummarySkeleton />
      <MonthCardSkeleton />
      <Card className="gap-2">
        <CardHeader>
          <CardTitle>{t("balance.title")}</CardTitle>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          <ChartSkeleton />
        </CardContent>
      </Card>
      <Card className="gap-2">
        <CardHeader>
          <CardTitle>{t("forecast.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TableSkeleton rows={4} columns={4} />
        </CardContent>
      </Card>
      <Card className="gap-2">
        <CardHeader>
          <CardTitle>{t("nearest.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <NearestSkeleton />
        </CardContent>
      </Card>
    </>
  );
}

/** A report card: its total, the treemap, the table under it */
export function ReportCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
          <Line size="lg" w="w-44" />
          <Line w="w-36" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <TreemapSkeleton />
        <TableSkeleton rows={5} columns={2} className={TAIL} />
      </CardContent>
    </Card>
  );
}

/** A settings card before its content: a title, a hint, a control */
export function SettingsCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Line size="base" w="w-40" />
        <Line w="w-72" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-9 w-full sm:w-64" />
      </CardContent>
    </Card>
  );
}
