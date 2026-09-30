// Edge-runtime Sentry. A no-op unless NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";

import { SENTRY_DATA_COLLECTION } from "~/lib/sentry-options";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV || undefined,
  tracesSampleRate: 0.1,
  // this app's events are about money: no client IP, no user identifiers
  dataCollection: SENTRY_DATA_COLLECTION,
});
