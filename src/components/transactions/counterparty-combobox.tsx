"use client";

import { CheckIcon, ChevronsUpDownIcon, PlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Command,
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
import { useDeferredRefocus } from "~/hooks/use-deferred-refocus";
import { matchesAnyLayout } from "~/lib/keyboard-layouts";
import { cn } from "~/lib/utils";

export type CounterpartyValue = { id?: string; name: string } | null;

const CREATE = "__create__";

/**
 * Create-or-select: pick an existing counterparty, or type a new name that
 * is created (or matched case-insensitively) on save. ↑/↓/Enter work in the
 * list.
 */
export function CounterpartyCombobox({
  id,
  options,
  value,
  onChange,
  invalid,
}: {
  id?: string;
  options: { id: string; name: string }[];
  value: CounterpartyValue;
  onChange: (value: CounterpartyValue) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("form");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { triggerRef, onCloseAutoFocus } =
    useDeferredRefocus<HTMLButtonElement>();

  const typed = search.trim();
  const exact = options.find(
    (option) => option.name.toLowerCase() === typed.toLowerCase(),
  );

  const pick = (next: CounterpartyValue) => {
    onChange(next);
    setSearch("");
    setOpen(false);
  };

  return (
    <div className="relative">
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
            className={cn(
              "w-full justify-between font-normal",
              value && "pr-9",
            )}
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {value?.name ?? t("searchCounterparty")}
            </span>
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) min-w-60 p-0"
          align="start"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Command
            filter={(itemValue, query) => {
              if (itemValue === CREATE) {
                return 1;
              }

              const option = options.find((o) => o.id === itemValue);

              return option && matchesAnyLayout(option.name, query) ? 1 : 0;
            }}
          >
            <CommandInput
              placeholder={t("searchCounterparty")}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandGroup>
                {typed && !exact ? (
                  <CommandItem
                    value={CREATE}
                    onSelect={() => pick({ name: typed })}
                  >
                    <PlusIcon className="size-4" />
                    {t("createCounterparty", { name: typed })}
                  </CommandItem>
                ) : null}
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    onSelect={() => pick({ id: option.id, name: option.name })}
                  >
                    <CheckIcon
                      className={cn(
                        "size-4",
                        value?.id === option.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{option.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-7 -translate-y-1/2"
          aria-label={t("noCounterparty")}
          onClick={() => onChange(null)}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}
