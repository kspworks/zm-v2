"use client";

import { useEffect, useEffectEvent, useState } from "react";

/** How far below the viewport the sentinel starts the next load. */
const AHEAD = "600px";

/**
 * Calls `onLoad` when the element given to the returned callback ref comes
 * within reach of the viewport, for an infinite list. While `enabled` is
 * false (a page is loading, none is left, the last fetch failed) nothing is
 * observed; when it turns true again the observer reports the element's
 * current position, so a screen that still isn't full keeps loading.
 * Without `IntersectionObserver` it does nothing, so keep a manual control.
 */
export const useLoadOnScroll = ({
  enabled,
  onLoad,
}: {
  enabled: boolean;
  onLoad: () => void;
}) => {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const load = useEffectEvent(onLoad);

  useEffect(() => {
    if (!node || !enabled || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          load();
        }
      },
      { rootMargin: `0px 0px ${AHEAD} 0px` },
    );
    observer.observe(node);

    return () => observer.disconnect();
  }, [node, enabled]);

  return setNode;
};
