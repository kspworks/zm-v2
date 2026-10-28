# syntax=docker.io/docker/dockerfile:1

# 24 to match ".nvmrc" and "engines.node"; pnpm-workspace.yaml sets
# engineStrict, so an older line makes the install refuse outright
FROM node:24-alpine AS base

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NEXT_TELEMETRY_DISABLED=1

# --- dependencies and build
FROM base AS builder

WORKDIR /app

# pnpm-workspace.yaml is load-bearing: it carries the "@swc/helpers" override
# without which the standalone bundle can't load a module it needs
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# no --prod: the build needs typescript, esbuild and the rest of devDependencies
RUN corepack enable && pnpm install --frozen-lockfile

COPY src ./src
COPY scripts ./scripts
COPY drizzle ./drizzle
COPY next.config.ts postcss.config.mjs drizzle.config.ts tsconfig.json ./
COPY instrumentation-client.ts sentry.server.config.ts sentry.edge.config.ts ./

# NEXT_PUBLIC_* values are inlined at build time, and SENTRY_AUTH_TOKEN uploads
# the source maps. They arrive as a dotenv-format build secret, for this RUN
# only, so the image can go to a registry:
#   docker build --secret id=dotenv,src=.env.docker ...
#
# Sourced into the environment rather than mounted as "/app/.env": "next build"
# copies any ".env" it finds into ".next/standalone", which would put every
# secret in the file into the runtime image. The check after the build keeps it
# that way. Everything else is read at runtime from the container's environment,
# hence SKIP_ENV_VALIDATION here.
#
# A secret's contents are not part of BuildKit's cache key, so new values would
# be ignored in favour of a cached build made with the old ones. A hash of the
# file (never the values) ties the cache to them:
#   --build-arg BUILD_ENV_REVISION="$(sha256sum .env.docker | cut -c1-64)"
ARG BUILD_ENV_REVISION
RUN --mount=type=secret,id=dotenv,required=false \
    if [ -f /run/secrets/dotenv ]; then set -a; . /run/secrets/dotenv; set +a; fi \
    && SKIP_ENV_VALIDATION=1 pnpm run build \
    && pnpm run build:scripts \
    && if ls -A .next/standalone | grep -q '^\.env'; then \
         echo "an .env file reached .next/standalone" >&2; exit 1; \
       fi

# --- production image
FROM base AS runner

# the deploy prunes old images by this label, so other apps' images on the
# same host are never touched
LABEL kspworks.zm-v2=app

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# the standalone server binds to $HOSTNAME, which Docker sets to the container
# id - pin it to all interfaces
ENV HOSTNAME=0.0.0.0

# 10001 rather than a low system id: it owns nothing on the host, so a process
# escaping as it gains nothing there either
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app -H -s /sbin/nologin app

# No --chown: the code stays owned by root, so the app can read it but never
# change it. The only writable paths are the tmpfs mounts in compose.vps.yml.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# read from process.cwd() by migrate.mjs (the standalone trace has them too,
# but only as a side effect of the RUN_MIGRATIONS escape hatch)
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/build/migrate.mjs /app/build/cron.mjs ./

USER 10001:10001

# "/auth/login" rather than "/": it is public and actually rendered, while "/"
# is a redirect answered before any page module loads - see smoke-standalone.sh
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -q --spider http://127.0.0.1:3000/auth/login || exit 1

CMD ["node", "server.js"]
