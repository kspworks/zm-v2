"use client";

import { useCallback, useRef } from "react";

/**
 * Popover comboboxes pick an item on Enter. If Radix hands focus back to the
 * trigger button while that key is still being processed, the button's own
 * Enter "click" re-opens the list. So skip the automatic focus return and
 * refocus the trigger on the next frame instead.
 */
export const useDeferredRefocus = <T extends HTMLElement>() => {
  const triggerRef = useRef<T>(null);

  const onCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  return { triggerRef, onCloseAutoFocus };
};
