import { createId } from "@paralleldrive/cuid2";
import { useCallback, useState } from "react";

/**
 * The idempotency key for one create intent. Every Save attempt of the same
 * entry sends the same key, so a retry after a lost response replays the
 * first result instead of writing a duplicate. Call `renew` once the entry is
 * saved (or abandoned) so the next one gets its own key.
 *
 * cuid2, not `crypto.randomUUID`, which is missing outside secure contexts
 * (a self-hosted instance opened over plain http).
 */
export const useIdempotencyKey = () => {
  const [key, setKey] = useState(createId);
  const renew = useCallback(() => setKey(createId()), []);

  return { key, renew };
};
