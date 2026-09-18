"use client";

import {
  parseAsArrayOf,
  parseAsIsoDate,
  parseAsString,
  useQueryStates,
} from "nuqs";
import { useMemo } from "react";

import { amountFilterRange } from "~/lib/money";
import type { TransactionFilter } from "~/lib/validators/transactions";

/**
 * The shared filter object, backed by URL search params so filters survive
 * reloads and can be shared. Dates are plain "yyyy-MM-dd" strings.
 */
const parsers = {
  accounts: parseAsArrayOf(parseAsString).withDefault([]),
  categories: parseAsArrayOf(parseAsString).withDefault([]),
  counterparties: parseAsArrayOf(parseAsString).withDefault([]),
  startDate: parseAsString,
  endDate: parseAsString,
  amount: parseAsString,
  comment: parseAsString,
};

const isIsoDate = (value: string | null) =>
  value !== null &&
  parseAsIsoDate.parse(value) !== null &&
  /^\d{4}-\d{2}-\d{2}$/.test(value);

export const useTransactionFilter = () => {
  const [state, setState] = useQueryStates(parsers, { history: "replace" });

  /**
   * What the server gets: only valid values. An invalid amount or a
   * reversed date range simply isn't applied (the bar shows the error).
   */
  const filter = useMemo((): TransactionFilter => {
    const startDate = isIsoDate(state.startDate) ? state.startDate : null;
    const endDate = isIsoDate(state.endDate) ? state.endDate : null;
    const reversed = !!startDate && !!endDate && startDate > endDate;

    return {
      accounts: state.accounts,
      categories: state.categories,
      counterparties: state.counterparties,
      startDate: reversed ? null : startDate,
      endDate: reversed ? null : endDate,
      amount:
        state.amount && amountFilterRange(state.amount) ? state.amount : null,
      comment: state.comment?.trim() || null,
    };
  }, [state]);

  const reset = () =>
    setState({
      accounts: null,
      categories: null,
      counterparties: null,
      startDate: null,
      endDate: null,
      amount: null,
      comment: null,
    });

  return { state, setState, filter, reset };
};

export type FilterState = ReturnType<typeof useTransactionFilter>["state"];
export type SetFilterState = ReturnType<
  typeof useTransactionFilter
>["setState"];
