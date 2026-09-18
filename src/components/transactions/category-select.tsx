"use client";

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import type { CategoryOption } from "~/lib/category-options";
import { lastInputWasPointer } from "~/lib/input-modality";
import { matchesAnyLayout } from "~/lib/keyboard-layouts";
import { cn } from "~/lib/utils";

const NONE = "__none__";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Moves focus to the field before/after `from` within its form */
export const focusNeighbour = (from: HTMLElement | null, step: 1 | -1) => {
  const form = from?.closest("form");

  if (!form || !from) {
    return;
  }

  const fields = [...form.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null,
  );
  const index = fields.indexOf(from);

  fields[index + step]?.focus();
};

/**
 * Single-select category combobox. Search is keyboard-layout-agnostic, and
 * Tab / Shift+Tab leave the open list for the neighbouring fields.
 */
export function CategorySelect({
  id,
  options,
  value,
  onChange,
  invalid,
}: {
  id?: string;
  options: CategoryOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("form");
  const tt = useTranslations("transactions");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlighted, setHighlighted] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tabStep = useRef<1 | -1 | null>(null);
  const selected = options.find((option) => option.id === value);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") {
      return;
    }

    event.preventDefault();

    // after typing a search, Tab accepts the highlighted option
    if (search.trim() && highlighted) {
      onChange(highlighted === NONE ? null : highlighted);
    }

    tabStep.current = event.shiftKey ? -1 : 1;
    setOpen(false);
  };

  // Radix would return focus to the trigger mid-keypress (and an Enter
  // there re-opens the list), so focus manually on the next frame: the
  // trigger itself, or its neighbour when the list was left with Tab.
  // After a pointer close focus stays put, so no focus ring is drawn
  const onCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    const step = tabStep.current;
    tabStep.current = null;
    setSearch("");
    if (lastInputWasPointer()) {
      return;
    }

    requestAnimationFrame(() =>
      step
        ? focusNeighbour(triggerRef.current, step)
        : triggerRef.current?.focus(),
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className="w-full justify-between font-normal"
        >
          <span
            className={cn("truncate", !selected && "text-muted-foreground")}
          >
            {selected?.label ??
              (value ? tt("deletedCategory") : t("pickCategory"))}
          </span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
        align="start"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <Command
          value={highlighted}
          onValueChange={setHighlighted}
          filter={(itemValue, search) => {
            if (itemValue === NONE) {
              return matchesAnyLayout(t("noCategory"), search) ? 1 : 0;
            }

            const option = options.find((o) => o.id === itemValue);

            return option && matchesAnyLayout(option.label, search) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder={t("searchCategory")}
            value={search}
            onValueChange={setSearch}
            onKeyDown={onKeyDown}
          />
          <CommandList>
            <CommandEmpty>—</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={NONE}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <CheckIcon
                  className={cn("size-4", value ? "opacity-0" : "opacity-100")}
                />
                <span className="text-muted-foreground">{t("noCategory")}</span>
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  onSelect={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn(
                      "size-4",
                      option.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
