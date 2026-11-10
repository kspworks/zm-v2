"use client";

import { format, parseISO } from "date-fns";
import { CalendarIcon, XIcon } from "lucide-react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { enGB, uk } from "react-day-picker/locale";

import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { formatDisplayDate } from "~/lib/dates";
import { cn } from "~/lib/utils";

/**
 * A calendar popover over a "yyyy-MM-dd" string: calendar dates never pass
 * through a Date in a time zone on their way to the server.
 */
export function DatePicker({
  id,
  value,
  onChange,
  placeholder,
  clearable = false,
  invalid = false,
  shortcuts,
  className,
}: {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  clearable?: boolean;
  invalid?: boolean;
  /** One-tap dates under the calendar, such as today and yesterday */
  shortcuts?: { label: string; value: string }[];
  className?: string;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-invalid={invalid}
            className={cn(
              "w-full justify-start font-normal tabular-nums",
              !value && "text-muted-foreground",
              clearable && value && "pr-8",
            )}
          >
            <CalendarIcon />
            {value ? formatDisplayDate(value) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            weekStartsOn={1}
            locale={locale === "en" ? enGB : uk}
            onSelect={(date) => {
              onChange(date ? format(date, "yyyy-MM-dd") : null);
              setOpen(false);
            }}
          />
          {shortcuts?.length ? (
            <div className="flex flex-wrap gap-1 border-t p-2">
              {shortcuts.map((shortcut) => (
                <Button
                  key={shortcut.value}
                  type="button"
                  size="sm"
                  variant={shortcut.value === value ? "secondary" : "ghost"}
                  className="flex-1 first-letter:uppercase"
                  onClick={() => {
                    onChange(shortcut.value);
                    setOpen(false);
                  }}
                >
                  {shortcut.label}
                </Button>
              ))}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {clearable && value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-1.5 -translate-y-1/2"
          aria-label="Clear"
          onClick={() => onChange(null)}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}
