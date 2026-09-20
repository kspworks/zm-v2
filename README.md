# ZM

A self-hosted, invite-only personal budget manager: accounts in several
currencies, expenses, incomes, transfers and debts, two-level categories,
planned (recurring) transactions with overdue reminders, per-person debt
tracking, ZenMoney CSV import, treemap reports, and email alerts when
tomorrow's planned payments would overdraw an account. English and
Ukrainian, light and dark.

## Stack

Next.js (App Router), TypeScript, tRPC, Drizzle ORM on PostgreSQL 15+,
better-auth (database sessions, TOTP, admin plugin), next-intl, Tailwind v4
with shadcn/ui, react-email, vitest, Biome.

## Local development

```shell
cp .env.example .env        # fill BETTER_AUTH_SECRET and CRON_SECRET
pnpm install
pnpm run db:migrate
pnpm dev
```

Create the first (admin) user at
[/auth/register/invite?id=admin](http://localhost:3000/auth/register/invite?id=admin).
That link only works while there is no active admin. In development the
code `111111` is accepted in place of an authenticator code.

## Tests

The suite calls the tRPC procedures, route handlers and better-auth's HTTP
handler against a real Postgres, so it needs Docker:

```shell
pnpm test           # starts docker-compose.test.yml (port 5433, tmpfs) on first run
pnpm test:tz        # the date tests with a non-UTC APP_TIMEZONE
pnpm test:db:down   # stop and remove the test database
```

Configuration lives in `.env.test`; variables already set in the environment
win, which is how CI (and a machine where port 5433 is taken:
`ZM_TEST_DB_PORT=5434 pnpm test:db:up`, then override `DATABASE_URL`) points
the suite at another database. Every table except `currencies` is truncated
between tests.

### Browser tests

Playwright drives the built standalone bundle (`dist/server.js`) in desktop
Chrome and on a Pixel 7: the admin bootstrap and sign-in with TOTP, every page
through the sidebar or the mobile menu sheet, and a money journey (account,
expense, income, planned payment, report). Any console error or uncaught
exception fails the test, which is what catches most breakage after a
dependency upgrade. They use a throwaway `zm_e2e` database on the same Docker
postgres as `pnpm test`, recreated on every run.

```shell
pnpm exec playwright install chromium   # once, and after a Playwright upgrade
pnpm test:e2e      # builds dist/, then runs the setup, anonymous, desktop and mobile projects
pnpm test:e2e:ui   # the same in Playwright's UI mode
E2E_PREBUILT=1 pnpm test:e2e   # reuse an existing dist/ (skips the ~1 min build)
E2E_DEV=1 pnpm test:e2e        # against `next dev`, for writing specs (stop your own `pnpm dev` first)
```

After `pnpm check-updates -u && pnpm install`, run `pnpm test && pnpm test:e2e`.
Screenshots of every page at phone width land in `test-results/`.

Before merging, CI also runs `biome ci`, `knip`, the typecheck, the migration
drift check, a smoke test of the standalone bundle (`smoke-standalone.sh`) and
the browser tests against that bundle.

## Deploying with docker-compose

- `cp .env.docker.example .env.docker` and fill in `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL` and `CRON_SECRET`. The app refuses to start without them.
- **Change the Postgres password**, in `docker-compose.yml` and in
  `DATABASE_URL`. The example one is public: it is in this repository.
- `docker compose up --wait` and open [http://localhost:3333](http://localhost:3333).

A `migrator` service applies the migrations and must exit successfully before
`next-app` starts, so the schema is never behind the code. The cron jobs
(below) are plain HTTP calls; from the host, for example:

```shell
curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://localhost:3333/api/cron/daily-0000
```

## Cron jobs

| Route | When | What |
|---|---|---|
| `/api/cron/daily-0000` | 00:00 in `APP_TIMEZONE` | rolls the one-year planned window forward, sweeps rate-limit rows |
| `/api/cron/daily-0900` | 09:00 in `APP_TIMEZONE` | emails readers of accounts that tomorrow's planned transactions would overdraw |

Both answer only `Authorization: Bearer <CRON_SECRET>` and return plain-text
logs. Self-hosted installs call them from system cron, e.g.
`0 0 * * *` and `0 9 * * *` in a crontab running in the app's time zone.

## Migrating from v1

On an empty, migrated database:

```shell
OLD_DATABASE_URL=postgres://… DATABASE_URL=postgres://… \
BETTER_AUTH_SECRET=<the production secret> pnpm run migrate:v1
```

It runs in one transaction, refuses a target that already has users, keeps
v1 passwords (bcrypt, rehashed on the next sign-in) and authenticators, turns
payees into counterparties (merging case variants, reported), and prints
row counts, balance mismatches and transactions per kind.

## Self-hosting

A step-by-step Vercel guide and the pm2 setup are in
[SELF-HOSTING.md](SELF-HOSTING.md).
