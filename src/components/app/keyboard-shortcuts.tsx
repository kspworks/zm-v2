"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import { Kbd, KbdGroup } from "~/components/ui/kbd";

/** `g` then a letter: by physical key, so it works on any keyboard layout */
const GO_TO: Record<string, string> = {
  KeyD: "/dashboard",
  KeyT: "/transactions",
  KeyP: "/planned",
  KeyR: "/reports/map",
  KeyB: "/budgets",
  KeyA: "/accounts",
  KeyC: "/categories",
  KeyS: "/settings",
};

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest('[role="combobox"], [role="listbox"]') !== null);

/** One still closing has `data-state="closed"` and no longer counts */
const overlayOpen = () =>
  document.querySelector(
    ':is([role="dialog"], [role="alertdialog"], [role="menu"])[data-state="open"]',
  ) !== null;

const focusSearch = () => {
  const search = document.querySelector<HTMLInputElement>(
    'main input[type="search"]',
  );

  search?.focus();
  return !!search;
};

/** N adds, / searches, G then a letter jumps, ? lists them */
export function useKeyboardShortcuts({
  onAdd,
  onHelp,
}: {
  onAdd: () => void;
  onHelp: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const goPending = useRef<number | null>(null);
  const searchPending = useRef(false);

  // "/" away from a list opens Transactions, then focuses its search
  useEffect(() => {
    if (searchPending.current && pathname === "/transactions") {
      searchPending.current = false;
      const timer = window.setTimeout(focusSearch, 150);

      return () => window.clearTimeout(timer);
    }
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        typing(event.target) ||
        overlayOpen()
      ) {
        return;
      }

      if (goPending.current !== null) {
        window.clearTimeout(goPending.current);
        goPending.current = null;
        const href = GO_TO[event.code];

        if (href) {
          event.preventDefault();
          router.push(href);
        }
        return;
      }

      if (event.code === "KeyG" && !event.shiftKey) {
        goPending.current = window.setTimeout(() => {
          goPending.current = null;
        }, 1200);
      } else if (event.code === "KeyN" && !event.shiftKey) {
        event.preventDefault();
        onAdd();
      } else if (event.code === "Slash" && event.shiftKey) {
        event.preventDefault();
        onHelp();
      } else if (event.code === "Slash") {
        event.preventDefault();

        if (!focusSearch()) {
          searchPending.current = true;
          router.push("/transactions");
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onAdd, onHelp, router]);
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("shortcuts");

  const rows: [string[], string][] = [
    [["N"], t("add")],
    [["/"], t("search")],
    [["G", "D"], t("dashboard")],
    [["G", "T"], t("transactions")],
    [["G", "P"], t("planned")],
    [["G", "R"], t("reports")],
    [["G", "B"], t("budgets")],
    [["G", "A"], t("accounts")],
    [["G", "C"], t("categories")],
    [["G", "S"], t("settings")],
    [["?"], t("help")],
  ];

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("hint")}
    >
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2.5 text-sm">
        {rows.map(([keys, label]) => (
          <div key={label} className="contents">
            <dt>
              <KbdGroup>
                {keys.map((key, index) => (
                  <span key={key} className="inline-flex items-center gap-1">
                    {index > 0 ? (
                      <span className="text-muted-foreground text-xs">
                        {t("then")}
                      </span>
                    ) : null}
                    <Kbd>{key}</Kbd>
                  </span>
                ))}
              </KbdGroup>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </ResponsiveDialog>
  );
}
