"use client";

import { useQuery } from "@tanstack/react-query";
import { SearchIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { useDebouncedField } from "~/components/transactions/filter-bar";
import type {
  FilterState,
  SetFilterState,
} from "~/components/transactions/use-filter";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { categoryOptions } from "~/lib/category-options";
import { formatDisplayDate } from "~/lib/dates";
import { NO_CATEGORY } from "~/lib/validators/transactions";
import { useTRPC } from "~/trpc/react";

const always = () => true;

type Chip = { key: string; label: string; clear: () => void };

/** One chip per value, so each can go without reopening the filters */
const useChips = (state: FilterState, setState: SetFilterState): Chip[] => {
  const t = useTranslations("filters");
  const tk = useTranslations("form.kinds");
  const locale = useLocale();
  const trpc = useTRPC();
  const accounts = useQuery({
    ...trpc.accounts.list.queryOptions(),
    enabled: state.accounts.length > 0,
  });
  const categories = useQuery({
    ...trpc.categories.list.queryOptions(),
    enabled: state.categories.length > 0,
  });
  const counterparties = useQuery({
    ...trpc.counterparties.list.queryOptions(),
    enabled: state.counterparties.length > 0,
  });

  const options = categoryOptions(categories.data ?? [], locale);
  const chips: Chip[] = [];

  const each = (
    key: "accounts" | "categories" | "counterparties",
    labelOf: (id: string) => string | undefined,
  ) => {
    for (const id of state[key]) {
      const label = labelOf(id);

      if (label) {
        chips.push({
          key: `${key}-${id}`,
          label,
          clear: () =>
            void setState({ [key]: state[key].filter((x) => x !== id) }),
        });
      }
    }
  };

  each("accounts", (id) => accounts.data?.find((a) => a.id === id)?.name);
  each("categories", (id) =>
    id === NO_CATEGORY
      ? t("noCategory")
      : options.find((option) => option.id === id)?.label,
  );
  each(
    "counterparties",
    (id) => counterparties.data?.find((c) => c.id === id)?.name,
  );

  for (const kind of state.kinds) {
    chips.push({
      key: `kind:${kind}`,
      label: tk(kind),
      clear: () =>
        void setState({ kinds: state.kinds.filter((x) => x !== kind) }),
    });
  }

  if (state.startDate || state.endDate) {
    const from = state.startDate ? formatDisplayDate(state.startDate) : "";
    const to = state.endDate ? formatDisplayDate(state.endDate) : "";

    chips.push({
      key: "dates",
      label: `${from} – ${to}`.trim(),
      clear: () => void setState({ startDate: null, endDate: null }),
    });
  }

  if (state.amount) {
    chips.push({
      key: "amount",
      label: `${t("amount")}: ${state.amount}`,
      clear: () => void setState({ amount: null }),
    });
  }

  if (state.comment) {
    chips.push({
      key: "comment",
      label: `“${state.comment}”`,
      clear: () => void setState({ comment: null }),
    });
  }

  return chips;
};

/** Search stays in view, and every active filter says what it is */
export function FilterSummary({
  state,
  setState,
  reset,
}: {
  state: FilterState;
  setState: SetFilterState;
  reset: () => void;
}) {
  const t = useTranslations("filters");
  const chips = useChips(state, setState);
  const [text, setText] = useDebouncedField(
    state.comment,
    (value) => void setState({ comment: value }),
    always,
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          type="search"
          autoComplete="off"
          aria-label={t("searchComments")}
          placeholder={t("searchComments")}
          className="pl-8"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <Button
              key={chip.key}
              variant="secondary"
              size="xs"
              className="max-w-64"
              aria-label={t("removeFilter", { name: chip.label })}
              onClick={chip.clear}
            >
              <span className="truncate">{chip.label}</span>
              <XIcon />
            </Button>
          ))}
          {chips.length > 1 ? (
            <Button variant="ghost" size="xs" onClick={reset}>
              {t("clearAll")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
