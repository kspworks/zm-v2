"use client";

import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * The list language of the ledger pages (Transactions, Planned, Accounts,
 * Categories): rows in bordered cards, and in a wide list a label column on
 * the left that heads each card.
 */
export function LedgerGroups({ children }: { children: ReactNode }) {
  return (
    // a container query never matches its own container, so the gap sits
    // on an inner element
    <div className="@container">
      <div className="flex flex-col @2xl:gap-1.5">{children}</div>
    </div>
  );
}

/** A label beside (wide) or above (narrow) its card of rows */
export function LedgerGroup({
  heading,
  children,
}: {
  heading: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="@2xl:grid @2xl:grid-cols-[8.5rem_minmax(0,1fr)] @2xl:items-start @2xl:gap-x-3">
      {heading}
      <LedgerCard>{children}</LedgerCard>
    </section>
  );
}

/**
 * A group's label: a title and a quieter line under it. In a wide list it
 * takes no height (`h-0`, the text overflows), so the card alone sizes the
 * group: two lines are taller than a one-row card, and would otherwise leave
 * a wider gap after single-row groups.
 */
export function LedgerHeading({
  title,
  children,
}: {
  title: ReactNode;
  /** The second line */
  children?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 @max-2xl:px-3 @max-2xl:pt-4 @max-2xl:pb-1.5 @max-2xl:sm:px-4 @max-2xl:md:pt-2.5 @max-2xl:md:pb-1 @2xl:h-0 @2xl:flex-col @2xl:gap-0 @2xl:pt-1.5 @2xl:pl-1">
      <span className="text-sm font-semibold">{title}</span>
      {children}
    </div>
  );
}

/** The bordered card that holds a group's rows */
export function LedgerCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-card divide-y overflow-hidden rounded-lg border">
      {children}
    </div>
  );
}

/**
 * One row of a ledger card, laid out like a transaction: the title (with its
 * badges) and the meta text stacked on phones and on one line from md up,
 * then the amount and the row menu. Clicking anywhere on the row opens it;
 * the title is a button, so the keyboard and screen readers have the same
 * path.
 */
export function LedgerRow({
  title,
  titleClassName,
  leading,
  badges,
  meta,
  amount,
  actions,
  onOpen,
  className,
}: {
  title: ReactNode;
  titleClassName?: string;
  /** An icon or a color swatch before the title */
  leading?: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  amount?: ReactNode;
  actions?: ReactNode;
  onOpen: () => void;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a wider mouse and touch target for the title button, which is the keyboard and screen-reader path
    // biome-ignore lint/a11y/useKeyWithClickEvents: the title button handles the keyboard
    <div
      data-slot="ledger-row"
      className={cn(
        "group hover:bg-accent/50 flex cursor-pointer gap-3 px-3 py-2.5 transition-colors sm:px-4 md:py-1",
        // two lines on phones hang from the top, like a transaction; one
        // line sits in the middle of the touch-sized row
        meta ? "items-start md:items-center" : "items-center",
        className,
      )}
      onClick={() => {
        // selecting text to copy it is not a click on the row
        if (window.getSelection()?.isCollapsed !== false) {
          onOpen();
        }
      }}
    >
      {leading ? (
        <div className="flex h-5 shrink-0 items-center">{leading}</div>
      ) : null}
      <div className="min-w-0 flex-1 md:flex md:items-center md:gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className={cn(
              "focus-visible:ring-ring min-w-0 truncate rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-2",
              titleClassName,
            )}
          >
            {title}
          </button>
          {badges}
        </div>
        {meta ? (
          <p className="text-muted-foreground truncate text-xs max-md:mt-0.5 md:ml-auto md:max-w-[50%] md:shrink-0 md:text-right">
            {meta}
          </p>
        ) : null}
      </div>
      {amount ? (
        <div className="flex shrink-0 flex-col items-end md:min-w-28">
          {amount}
        </div>
      ) : null}
      {actions ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: only keeps the menu's clicks from reaching the row
        // biome-ignore lint/a11y/useKeyWithClickEvents: nothing to do from the keyboard here
        <div
          data-slot="ledger-row-actions"
          className="-mr-2 shrink-0"
          onClick={(event) => event.stopPropagation()}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
