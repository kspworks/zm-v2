"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last resort when the root layout itself fails: no providers (and so no
 * translations) are available, so both languages are shown.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="uk">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h1>Щось пішло не так · Something went wrong</h1>
          <button type="button" onClick={reset}>
            Спробувати ще · Try again
          </button>
        </div>
      </body>
    </html>
  );
}
