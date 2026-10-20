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
RUN corepack enable && pnpm install --frozen-lockfile

COPY src ./src
COPY drizzle ./drizzle
COPY next.config.ts postcss.config.mjs drizzle.config.ts tsconfig.json ./
COPY instrumentation-client.ts sentry.server.config.ts sentry.edge.config.ts ./

# NEXT_PUBLIC_* values are inlined at build time; everything else is read at
# runtime from the environment the container gets
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_ENV="production"
ARG NEXT_PUBLIC_BUILD_ID=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_ENV=$NEXT_PUBLIC_SENTRY_ENV \
    NEXT_PUBLIC_BUILD_ID=$NEXT_PUBLIC_BUILD_ID

RUN SKIP_ENV_VALIDATION=1 pnpm run build

# --- migrations, as their own target so compose runs them to completion
# before the app starts: the same "pnpm db:migrate" the other deploys use
FROM builder AS migrator

CMD ["pnpm", "run", "db:migrate"]

# --- production image
FROM base AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

CMD ["node", "server.js"]
