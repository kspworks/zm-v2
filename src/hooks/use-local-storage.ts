import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { z } from "zod";

/** Same-tab writes; the `storage` event only fires in other tabs */
const LOCAL_EVENT = "zm:local-storage";

/** Where writes go when localStorage throws, so they last for the page */
const memory = new Map<string, string>();

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
};

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(LOCAL_EVENT, onChange);

  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LOCAL_EVENT, onChange);
  };
};

/**
 * A per-browser preference in localStorage, validated by `schema`. Missing,
 * malformed or unreadable data (private mode, blocked storage) yields
 * `fallback`. `ready` is false while rendering on the server and hydrating,
 * so callers can hold off work that depends on the stored value.
 */
export function useLocalStorage<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): [value: T, setValue: (value: T) => void, ready: boolean] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => undefined,
  );

  // `fallback` is usually an inline literal, so only `raw` drives re-parsing
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  const value = useMemo(() => {
    if (raw == null) {
      return fallback;
    }

    try {
      const parsed = schema.safeParse(JSON.parse(raw));

      return parsed.success ? parsed.data : fallback;
    } catch {
      return fallback;
    }
  }, [raw, schema]);

  const setValue = useCallback(
    (next: T) => {
      const raw = JSON.stringify(next);

      try {
        window.localStorage.setItem(key, raw);
      } catch {
        memory.set(key, raw);
      }
      window.dispatchEvent(new Event(LOCAL_EVENT));
    },
    [key],
  );

  return [value, setValue, raw !== undefined];
}
