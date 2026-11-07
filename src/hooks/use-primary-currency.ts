"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

/** The user's primary currency id, null until chosen or still loading */
export const usePrimaryCurrency = () => {
  const trpc = useTRPC();
  const primary = useQuery(trpc.me.primaryCurrency.queryOptions());

  return {
    currencyId: primary.data?.currencyId ?? null,
    ready: !primary.isPending,
  };
};
