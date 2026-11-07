import type { TransactionFilter } from "~/lib/validators/transactions";

/**
 * A link to a list filtered by the same URL params `useTransactionFilter`
 * reads, so a summary row can open the rows behind it.
 */
export const filteredHref = (
  path: "/transactions" | "/planned",
  filter: Partial<TransactionFilter>,
): string => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filter)) {
    if (Array.isArray(value) ? value.length > 0 : value) {
      params.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
  }

  const query = params.toString();

  return query ? `${path}?${query}` : path;
};
