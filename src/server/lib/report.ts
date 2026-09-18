import * as Sentry from "@sentry/nextjs";

/**
 * Logs an unexpected failure and forwards it to Sentry (a no-op when Sentry is
 * not initialised because no DSN is configured).
 */
export const reportError = (error: unknown, context?: string): void => {
  if (process.env.NODE_ENV !== "test") {
    // biome-ignore lint/suspicious/noConsole: server-side error log
    console.error(`[ERROR]${context ? ` [${context}]` : ""}`, error);
  }

  Sentry.captureException(error, context ? { tags: { context } } : undefined);
};
