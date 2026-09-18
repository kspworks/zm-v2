import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// validates the environment at build and boot; SKIP_ENV_VALIDATION opts out
import "./src/env";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  typedRoutes: false,
};

export default withNextIntl(config);
