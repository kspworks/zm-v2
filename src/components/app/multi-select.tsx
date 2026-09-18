"use client";

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { Badge } from "~/components/ui/badge";
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
import { matchesAnyLayout } from "~/lib/keyboard-layouts";
import { cn } from "~/lib/utils";

export type MultiSelectOption = {
  value: string;
  label: string;
  hint?: ReactNode;
};

/** A searchable multi-select; search is keyboard-layout-agnostic */
export function MultiSelect({
  id,
  label,
  options,
  value,
  onChange,
  className,
}: {
  id?: string;
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}) {
  const t = useTranslations("filters");
  const [open, setOpen] = useState(false);
  const selected = new Set(value);

  const toggle = (option: string) => {
    const next = new Set(selected);

    if (next.has(option)) {
      next.delete(option);
    } else {
      next.add(option);
    }

    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  };

  const single =
    value.length === 1
      ? options.find((option) => option.value === value[0])?.label
      : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span
            className={cn("truncate", !value.length && "text-muted-foreground")}
          >
            {single ?? (value.length ? label : t("any"))}
          </span>
          <span className="flex items-center gap-1">
            {value.length > 1 ? (
              <Badge variant="secondary">{value.length}</Badge>
            ) : null}
            <ChevronsUpDownIcon className="opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-60 p-0"
        align="start"
      >
        <Command
          filter={(itemValue, search) => {
            const option = options.find((o) => o.value === itemValue);

            return option && matchesAnyLayout(option.label, search) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={t("search")} />
          <CommandList>
            <CommandEmpty>—</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => toggle(option.value)}
                >
                  <CheckIcon
                    className={cn(
                      "size-4",
                      selected.has(option.value) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="ml-auto text-muted-foreground text-xs">
                      {option.hint}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
