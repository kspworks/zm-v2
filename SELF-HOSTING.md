# How to deploy a self-hosted ZM instance

## Vercel

1. [Create a Vercel account](https://vercel.com/signup) or [log in](https://vercel.com/login).
2. [Connect your GitHub/GitLab account](https://vercel.com/account/settings/authentication) if you haven't yet.
3. Fork this repository (only the `main` branch is needed).
4. [Import the fork into Vercel](https://vercel.com/new) with the default settings and press `Deploy`.
5. The first deploy fails with `Invalid environment variables`. That's expected: click `Go to Project`.
6. Open the `Storage` tab, pick `Neon (Serverless Postgres)` and click `Create`:
   - `Region`: the closest to you (for example `Frankfurt, Germany (West)`)
   - `Tier`: `Free` is enough
   - `Database Name`: anything, it's filled into the environment for you
   - Click `Create`, then `Done`
   - `Environments`: keep only `Production`
   - Click `Connect`
7. Open `Settings` → `Environment Variables` and add:
   - `BETTER_AUTH_SECRET`: a random string, e.g. `openssl rand -base64 32`
   - `CRON_SECRET`: a random string of at least 16 characters, e.g. `openssl rand -hex 24`
   - `APP_TIMEZONE`: your time zone, e.g. `Europe/Kyiv` (the default)
   - `TRANSACTIONS_PAGINATION_LIMIT`: `50` (optional, the default)
   - `BETTER_AUTH_URL` can stay unset: `VERCEL_URL` is used. Set it to
     `https://your-domain` once you use a custom domain.
   - Click `Save`, then `Redeploy` in the toast, and `View deployment`.
8. Wait for the build (3–4 minutes). It applies the database migrations
   (`vercel-build` = build + migrate). That covers the database attached to
   `Production` only; migrate any other one with `pnpm run db:migrate`.
9. Open `Settings` → `Functions`, enable `Fluid Compute`, save and redeploy.
10. Create the admin: open `https://YOUR-DOMAIN/auth/register/invite?id=admin`
    and follow the steps (name, email, password, authenticator app, backup codes).
    The link stops working once an admin exists.
11. Optional:
    - Email (insufficient-funds alerts and "forgot password"): set `MAIL_HOST`,
      `MAIL_PORT` (465 for TLS), `MAIL_USERNAME`, `MAIL_PASSWORD` and optionally
      `MAIL_FROM`. The host and port are used as given.
    - Sentry: `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENV`, and for source
      maps `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.

### Cron on Vercel runs in UTC

`vercel.json` schedules `/api/cron/daily-0000` at `0 0 * * *` and
`/api/cron/daily-0900` at `0 9 * * *`, and Vercel reads those in **UTC**.
The jobs compute "today" and "tomorrow" in `APP_TIMEZONE`, so they are
correct at any hour, but the email arrives at 09:00 UTC. To get it at 09:00
local time, shift the schedule by your offset, e.g. for `Europe/Kyiv`
(UTC+2 in winter, UTC+3 in summer) use `0 7 * * *` or `0 6 * * *`. For the
midnight job, running shortly *after* local midnight is what matters
(`0 22 * * *` is 00:00 in Kyiv in winter).

## Self-hosted with pm2 (GitLab deploy)

The GitLab pipeline (`.gitlab-ci.yml`) builds on the server with
`pnpm run build:selfhosted`, smoke-tests the bundle, runs
`pnpm run db:migrate`, copies `dist/` to the served directory and restarts
pm2. See `ecosystem.config.example.cjs` for the pm2 config, and keep the
production `.env` next to `server.js`.

Two other ways to migrate, if a deploy step isn't possible:

- `docker compose` runs a `migrator` service before the app;
- the escape hatch: create an empty `RUN_MIGRATIONS` file next to
  `server.js`. The next boot applies the migrations under a Postgres advisory
  lock (so several processes can't race) and removes the file only after a
  successful run.

## Running more than one process

Production runs pm2 in **cluster mode with 2 processes**, and Vercel runs many
serverless instances. So:

- **No in-process state.** Rate limits, locks and caches live in Postgres; a
  module variable would exist once per process.
- **No read-then-write races.** Check-then-write logic is a single
  statement, a row lock (`SELECT … FOR UPDATE`) or an advisory lock.
- **Module top level runs once per process**, which is why the
  `RUN_MIGRATIONS` escape hatch takes an advisory lock.
