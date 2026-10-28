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
10. Create the admin: open `https://YOUR-DOMAIN` and follow the sign-in page's
    link to `/auth/register/invite?id=admin` (name, email, password,
    authenticator app, backup codes). The link disappears, and the invite
    stops working, once an admin exists.
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

## Self-hosted with Docker (GitLab deploy)

The app runs as Docker containers on a VPS, isolated from the other apps on
the same server. Host Apache terminates TLS and proxies to
`127.0.0.1:$APP_PORT`. Postgres stays on the host and is reached over its
socket.

On every push to `main`, the GitLab pipeline (`.gitlab-ci.yml`) runs lint,
typecheck and tests. When they pass, it builds the image (`Dockerfile`,
target `runner`), has it migrate a throwaway database and render a page from
a read-only filesystem, and pushes it to the GitLab registry. The deploy job
then:

1. copies `compose.vps.yml` to `$PROD_OUT_PATH/compose.yml`;
2. pulls the image and runs the migrations (`node migrate.mjs`). A failure
   stops here, with the old containers still serving;
3. recreates `web` and `cron`;
4. removes this app's images older than 30 days that no container uses. It
   finds them by the label `kspworks.zm-v2=app`, so other apps' images are
   left alone.

If the app is compromised, the attacker stays inside those containers:

- They run as UID 10001, which owns nothing on the host. The filesystem is
  read-only, with no Linux capabilities, `no-new-privileges` and no Docker
  socket. The code is owned by root inside the image, so it can't be changed
  either.
- They see only this app's `.env` and the Postgres socket, and the Postgres
  role can touch only this app's database. The `cron` container gets nothing
  but `CRON_SECRET` and `APP_TIMEZONE`.
- Containers share the host kernel, so keep the kernel and Docker patched
  (unattended-upgrades).

The `RUN_MIGRATIONS` escape hatch (below) can't fire in the image: the
read-only filesystem can't hold the file.

### One-time setup

1. **Deploy user.** A user for CI, in the `docker` group. Membership in that
   group is root-equivalent, so the user should hold nothing else. Restrict
   its key in `authorized_keys` (`from="…",no-port-forwarding,no-pty`), and
   point the `SSH_CONNECT` and `SSH_PRIVATE_KEY_BASE64` CI variables at it.
2. **Registry login.** As that user, `docker login registry.gitlab.com`.
   Docker keeps **one credential per registry host**, so if the user already
   pulls other projects' images from `registry.gitlab.com`, a project deploy
   token won't do: use a **group** deploy token (`read_registry`) that covers
   every project the user deploys.
3. **App directory** (`PROD_OUT_PATH`), owned by the deploy user:
   ```bash
   sudo install -d -o <deploy-user> -m 750 /srv/zm-v2
   ```
4. **A Postgres role that can touch only this app's database:**
   ```sql
   CREATE ROLE zm_v2 LOGIN PASSWORD '<openssl rand -hex 24>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
   ALTER DATABASE <db> OWNER TO zm_v2;
   REVOKE CONNECT ON DATABASE <db> FROM PUBLIC;
   ```
   Migrations alter tables, so the role has to **own** the existing tables,
   sequences and types too. If the old role is used by this app alone, run
   `REASSIGN OWNED BY <old> TO zm_v2;` while connected to `<db>`. If it's
   shared (e.g. `postgres`), don't: `REASSIGN OWNED` also hands over that
   role's other databases. Run `ALTER TABLE/SEQUENCE/TYPE … OWNER TO zm_v2`
   per object instead.
5. **Let the role in over the socket, and only into its own database.** In
   `pg_hba.conf`, put these lines **above** the generic `local all all peer`
   line, then `sudo systemctl reload postgresql`:
   ```
   local   <db>   zm_v2   scram-sha-256
   local   all    zm_v2   reject
   ```
   Peer authentication can't work here: UID 10001 has no user on the host.
6. **`.env`** in `/srv/zm-v2` (`chmod 600`). Start from the old one:
   - keep `BETTER_AUTH_SECRET` as it was, so 2FA secrets stay readable and
     sessions stay valid;
   - set `BETTER_AUTH_URL`, `CRON_SECRET`, `APP_TIMEZONE` and `MAIL_*`;
   - `APP_IMAGE=registry.gitlab.com/<group>/<project>/app` (this project's
     `$CI_REGISTRY_IMAGE/app`) and `APP_PORT` (default `8092`);
   - `DATABASE_URL=postgresql://zm_v2:<password>@localhost/<db>` and
     `DATABASE_SOCKET_PATH=/var/run/postgresql/.s.PGSQL.5432`. The URL's host
     is ignored once the socket is set.
7. **CI variables:** `PROD_OUT_PATH=/srv/zm-v2`, and optionally
   `BUILD_DOTENV` (type **File**, protected) with the build-time values:
   `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENV`, `SENTRY_ORG`,
   `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN`.
8. **Check `ss -tlnp`.** Containers can reach host services listening on
   `0.0.0.0`, so other apps' databases, Redis and admin panels should listen
   on `127.0.0.1` or a socket.
9. **Apache vhost** (`a2enmod proxy proxy_http headers`):
   ```apache
   ProxyPreserveHost On
   RequestHeader set X-Forwarded-Proto "https"
   ProxyPass        / http://127.0.0.1:8092/
   ProxyPassReverse / http://127.0.0.1:8092/
   ```
10. **Switch over.** Run the pipeline on `main`, then check
    `curl -I http://127.0.0.1:8092/auth/login`. Once it answers,
    `apachectl configtest && sudo systemctl reload apache2`. Then stop the
    old setup: remove the app from pm2 (`pm2 delete <name> && pm2 save`) and
    the crontab entries that called the cron routes, or the jobs run twice.

Day to day, in `/srv/zm-v2`:

```bash
docker compose ps
docker compose logs -f web cron
IMAGE_TAG=<older commit sha> docker compose up -d web cron   # roll back
```

`compose.yml` defaults to the `latest` tag, so a bare `docker compose up -d`
runs the newest `main` build. Rolling back to a pruned image still works:
compose pulls it from the registry again.

### Other ways to migrate

- `docker compose` with `docker-compose.yml` runs a `migrator` service before
  the app;
- outside Docker, `pnpm run db:migrate`;
- the escape hatch: create an empty `RUN_MIGRATIONS` file next to
  `server.js`. The next boot applies the migrations under a Postgres advisory
  lock (the same one `migrate.mjs` takes, so nothing races) and removes the
  file only after a successful run.

## Security notes

- **Create the admin right after the first deploy.** Until an admin exists,
  anyone who reaches `/auth/register/invite?id=admin` can claim the instance.
- **Never run `pnpm dev` (`next dev`) on a reachable host.** In development
  mode `111111` is accepted in place of an authenticator code.
- **Change the example Postgres password** before the database is reachable
  from anywhere. The one in `docker-compose.yml` and `.env.docker.example` is
  public: it is in this repository.

## Running more than one process

The Docker deploy runs a single `web` container, but nothing may assume one
process: Vercel runs many serverless instances, and the container may be
scaled. So:

- **No in-process state.** Rate limits, locks and caches live in Postgres; a
  module variable would exist once per process.
- **No read-then-write races.** Check-then-write logic is a single
  statement, a row lock (`SELECT … FOR UPDATE`) or an advisory lock.
- **Module top level runs once per process**, which is why the
  `RUN_MIGRATIONS` escape hatch and `migrate.mjs` take an advisory lock.
