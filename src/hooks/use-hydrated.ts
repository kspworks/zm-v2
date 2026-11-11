import { useSyncExternalStore } from "react";

// the snapshot never changes after hydration, so there is nothing to listen to
const subscribe = () => () => {
  // nothing to unsubscribe
};

/**
 * False while rendering on the server and while hydrating that HTML, true
 * afterwards and on every client-only mount (a client-side navigation), so
 * those never see the server branch.
 */
export const useHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
