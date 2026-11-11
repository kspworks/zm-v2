"use client";

import type { ReactNode } from "react";

import { useHydrated } from "~/hooks/use-hydrated";

/**
 * Renders `fallback` on the server and while hydrating, and `children` from
 * the first client render on. For a view whose markup depends on the query
 * cache: TanStack Query renders from the cache during hydration, and the cache
 * may already hold data the server never had. A page waiting for its own chunk
 * stays dehydrated while the sidebar is interactive, and a "+" dialog opened
 * meanwhile fetches lists the page reads. Hydrating the route's loading
 * skeleton instead keeps the server HTML and the first client render equal
 * whatever the cache holds; the view then mounts as a plain client render.
 *
 * Use it inside the client view, not in `page.tsx`: a skeleton rendered by the
 * page puts its client components (the sidebar trigger) in the page's chunk
 * group, and the layout's sidebar would then wait for the page's code too.
 */
export function AfterHydration({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: ReactNode;
}) {
  return useHydrated() ? children : fallback;
}
