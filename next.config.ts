import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// validates the environment at build and boot; SKIP_ENV_VALIDATION opts out
import "./src/env";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingIncludes: {
    // read from disk by the RUN_MIGRATIONS escape hatch (src/instrumentation.ts)
    "/api/trpc/[trpc]": ["./drizzle/**/*"],
  },
};

export default withSentryConfig(withNextIntl(config), {
  org: process.env.SENTRY_ORG || undefined,
  project: process.env.SENTRY_PROJECT || undefined,
  silent: !process.env.CI,
  // browser events go through the app itself, past ad blockers
  tunnelRoute: "/monitoring",
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  telemetry: false,
});
