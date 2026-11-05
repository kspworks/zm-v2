<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ZM domain rules

ZM is a self-hosted, invite-only money tracker. `README.md` covers the stack,
setup and commands; `SELF-HOSTING.md` covers deployment. What follows is only
the behaviour that constrains new code and is not obvious from the module it
governs. Enumerations stay in code and are cited by path here, never copied.

## Conventions

- **Money** is an integer in minor units. The sign is relative to the account:
  negative means money left it. Formatting and parsing live in `~/lib/money`.
- **Calendar dates** are Postgres `date` columns handled as `yyyy-MM-dd`
  strings end to end (Drizzle `mode: "string"`). No timezone maths on them.
- **`APP_TIMEZONE`** (default `Europe/Kyiv`) defines "today" for the server:
  overdue checks, the cron's "tomorrow", the planned horizon, import stamps.
- **Weeks start on Monday**; weekday numbers are ISO 1 (Mon) to 7 (Sun).
- **Soft delete** (`deletedAt`) applies to users, accounts, categories, member
  rows, transactions and schedules. Every read filters `deletedAt IS NULL`, and
  uniqueness uses **partial unique indexes** `WHERE deleted_at IS NULL` — never
  a plain UNIQUE that includes `deleted_at`.
- **Queries** use Drizzle's query builder (`select`, `insert`, `update`,
  `delete`, `.for("update")`, `onConflictDoUpdate` …) whenever it can express
  the statement. Reach for the `sql` template only for an expression the
  builder lacks, embedded in a builder call, and for a whole raw statement
  (``db.execute(sql`…`)`` inside `query`) only when no builder form exists —
  advisory locks, for example. Never build SQL with string concatenation or `sql.raw` on
  input.

## Effect

Server code is written with **Effect v4** (`effect`). Keep every `effect` and
`@effect/*` package on the same version. The library ships its own guide in
`node_modules/effect/AGENTS.md` and `ai-docs/`; prefer it over memory, since
v4 renamed much of v3. Pure, client-shared helpers in `~/lib` stay plain
functions.

- **Shape.** An exported service function is `Effect.fn("module.name")(function* (…) {…})`;
  a private hot helper is `Effect.fnUntraced`. Domain logic stays as
  module-level functions whose requirements are only infrastructure services,
  not a class per domain. Never `async`/`await` or `throw` in server domain
  code. Combinators go as extra arguments to `Effect.fn` (`transaction`,
  `catchUniqueViolation(…)`), never `.pipe` on it.
- **Data access** only through `query((db) => db.…)` from `~/server/db/database`,
  which runs a Drizzle statement on the current handle and fails with
  `SqlError`. Services never take a handle parameter. A builder that other
  queries compose (`readableAccounts`) may take `db` and is called inside
  `query`.
- **Dependencies** are services provided by `AppLayer` (`~/server/effect/runtime`):
  `Database` (the current Drizzle handle), `AppConfig` (env-derived config) and
  `Mailer`. Domain code never reads `process.env`, the global `db` or
  `~/server/config` directly. Time comes only from `now` / `today` in
  `~/server/lib/clock` (Effect's `Clock`), never `new Date()` or `Date.now()`.
- **Concurrency**: independent reads go through `Effect.all(…, { concurrency: "unbounded" })`;
  inside a transaction they still share its one connection.
- **Boundaries** run effects on the one per-process `ManagedRuntime`:
  procedures use `runForTrpc(effect, signal)`; server components, better-auth
  hooks and cron routes use `runServer`, after handling expected errors with
  `Effect.catchTag`. The runtime holds no mutable application state.
- **Validation** is Effect Schema everywhere, never Zod: the shared input
  schemas in `~/lib/validators` (procedures wrap them with `validate(…)` from
  `~/server/api/trpc`, forms with `effectTsResolver`), env vars in `~/env`
  (through Standard Schema), CSV cells in `~/server/lib/csv-import`. Every
  check carries an app error key as its message (`message(key)` and the
  helpers in `~/lib/validators/common`), so forms show `errors.<key>` and no
  UI text comes from Schema. Use `Predicate` helpers instead of hand-written
  type guards.
- **Jobs and scripts.** A cron job is an effect handed to `cronHandler`
  (`~/server/cron`); it reports through `Effect.log`, which that handler
  collects into the response. Standalone scripts (`scripts/*.ts`) are programs
  run with `NodeRuntime.runMain` from `@effect/platform-node`, which owns exit
  codes and signals; a dedicated connection or lock is an
  `Effect.acquireRelease` resource (`~/server/db/migrate`).

## Multi-process safety

Production runs as more than one Node process (serverless on Vercel, and the
Docker `web` container may be scaled). So: **no in-process state** — locks and
caches live in Postgres, rate-limit counters in Redis or Postgres — and **no
read-then-write races** — use single statements, row locks (`.for("update")`)
or advisory locks. Redis holds only data that may be lost; anything that must
commit or roll back with a transaction (verifications, sessions, locks) stays
in Postgres.

## Atomicity and the audit log

Every mutation and all of its side effects (paired legs, the auto-created debt
account, the audit row) run in **one DB transaction**: the entry point passes
`transaction` (`~/server/db/database`) to its `Effect.fn`, and every helper it
calls runs on that handle through `query`. A typed failure, defect or
interruption rolls back and propagates unchanged; a nested `transaction` is a
SAVEPOINT, so services compose. Helpers that need the caller's transaction
(`getOrCreateDebtAccount`, `generateOccurrences`: their advisory locks are
transaction-scoped) don't open one. Every create, update, delete or restore of
an account, category, transaction or schedule writes a `history_logs` row in
that same transaction (`audit` in `~/server/lib/audit`).

## Errors

A business-rule violation fails with one of the tagged errors in
`~/server/lib/errors` (`badRequest(key)`, `forbidden(key)`, `notFound()` …,
raised as `return yield* …`) carrying a stable snake_case key that the client
translates as `errors.<key>`. The keys are defined in `~/lib/error-keys` — add
there, don't invent inline strings. `toTRPCError` (`~/server/effect/to-trpc-error`)
is the only place an Effect failure becomes a `TRPCError`: the tag picks the
code and the key is the message; `SqlError` and defects are 500s. A broken
invariant is `Effect.die`; never `Effect.orDie` an expected error. A unique
violation becomes a business error with `catchUniqueViolation(constraint, …)`.

## Access control

Per entity, through the member tables, with `canRead` / `canWrite`:

- Transaction **create** needs write access to the account, the linked account
  and the category. **Update** needs delete rights on the existing row _and_
  create rights on the new values. **Delete** covers both legs of a batch.
- Account write also requires the account not be of type `debt`; those are
  system-managed and cannot be shared.
- Every parent-category failure returns the single
  `fields_integrity_parent_not_allowed` answer, so IDs cannot be probed.

## Transactions

| Kind     | Rows                | Rules                                                                                                       |
| -------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| expense  | 1                   | `amount < 0`; a category must have `isExpense`                                                              |
| income   | 1                   | `amount > 0`; a category must have `isIncome`                                                               |
| transfer | 2, shared `batchId` | leg A negative, leg B positive on a different account; no category, no counterparty                         |
| debt     | 2, shared `batchId` | counterparty required; leg A on the real account, leg B the negated amount on the debt account; no category |

- **Primary leg**: for lists, filters and totals a batched pair is one row — the
  leg with `amount < 0` is primary and the other attaches as `linked`.
- The **kind can never change** on edit (`type_change_not_supported`).
- Editing a planned occurrence through the regular update **submits** it:
  `isPlanned = false`, `createdAt = now`.
- Delete soft-deletes every live row in the batch.
- **Balances are derived**: `initialBalance + SUM(amount)` over non-planned,
  non-deleted rows, computed in SQL on read. Never cache them.

## Debt accounts and wording

- At most one live `debt` account per (user, currency), created automatically on
  that user's first debt in that currency and named in the **creating user's**
  locale. It is never listed, offered in a select, or shared.
- The lent / borrowed / repaid decision table is `~/lib/debt-label`. Around it:
  - The label is computed **on read, never stored**, so backdated entries, edits
    and deletes relabel later rows automatically.
  - Ordering is `date`, then `createdAt`, then `id`.
  - The running balance is computed over the counterparty's whole history,
    **before** the list filters are applied — filtering must never change a
    label.
  - Planned occurrences are labelled against the projected balance (submitted
    history plus earlier planned occurrences) and read as a forecast.

## Filters, totals and reports

- **Amount** filtering: a value with no decimals matches the whole unit range
  (`100` matches 100.00–100.99); with decimals it matches exact cents. See
  `amountFilterRange` in `~/lib/money`.
- The category filter's `"null"` sentinel means "no category" and matches only
  non-batched rows without one.
- **Totals and report data** are computed server-side over the whole filtered
  set, not the loaded pages. They exclude transfers between the user's own
  non-debt accounts, and count a debt pair by its **real-account** leg.

## Planned transactions

- Generation is **idempotent**: the horizon is `min(endDate, today + 1 year)`,
  each occurrence is keyed by `md5(date + primaryScheduleId)`, and only missing
  hashes are inserted. Hashes of occurrences that were already submitted or
  deleted count as present, so those never come back.
- Only the **primary schedule** (no batch, or the negative leg) drives
  generation, and both legs carry `plannedTransactionId`. An advisory lock keeps
  concurrent runs (two cron processes, a save racing the cron) from
  double-inserting.
- Weekly emits, for each step, every selected weekday within the Monday-started
  week of that step, bounded by both `startDate` and the horizon.
- Editing a schedule soft-deletes un-submitted **future** occurrences and
  regenerates in one transaction, **clearing their hashes** so those dates come
  back under the new rules. Occurrences the user deleted one by one keep their
  hash and stay gone, and overdue un-submitted ones are kept.

## CSV import (ZenMoney export)

- The client **gzips** the file and sends it base64 in the tRPC JSON body, so a
  4 MB export is a ~700 KB request — inside the 4.5 MB body cap serverless
  hosts impose. Both limits live in `~/lib/import-limits`: `MAX_IMPORT_BYTES`
  measures the decoded file, `MAX_UPLOAD_BYTES` the compressed payload the
  router accepts.
- The server gunzips with `maxOutputLength`, so the decoded cap is enforced
  **during** inflation and a zip bomb never materialises. An oversized or
  non-gzip payload is `import_invalid`.
- The export carries a title on line 1 and the header on line 2, and amounts
  use a **comma decimal with exactly two places** (`"3000,00"`), so stripping
  the comma gives minor units. Reject a value that isn't an integer afterwards
  (`is_minor_units`) — a dot-decimal file would otherwise land 100× too small.
  Columns and the account-type keywords are in `~/server/lib/csv-import`.
- The **whole file is validated first**, returning row-level errors and writing
  nothing; only then are the import row, categories, accounts, transactions and
  counterparties created in one transaction. Accounts, categories and
  transactions carry the `importId` that Undo soft-deletes by.

## Locales

`en` and `uk`, default `uk`, with **no locale segment in URLs** (next-intl
without i18n routing). Resolution is the signed-in user's profile, then the
`NEXT_LOCALE` cookie, then `Accept-Language`, then the default; after sign-in
the profile wins and the cookie is rewritten. Rendering outside a request
(emails, seeded names, the debt-account name) uses the user's **stored** locale,
never a guess.

## Rate limiting and cron

- Limits are a fixed-window counter that returns the post-increment count in
  one atomic step: a Lua `INCR` + `PEXPIRE` in Redis when `REDIS_URL` is set
  (the `Redis` service, `~/server/effect/redis`), otherwise an upsert in
  Postgres. Any Redis failure or a command slower than 250 ms falls back to
  Postgres **for that call**, so a limit never fails open or locks everyone
  out; reset clears both stores. The keys live in `~/server/lib/rate-limit`.
- better-auth's own limiter goes through `rateLimit.customStorage` into the
  same `hitRateLimit`, never its memory store.
- Cron routes compare `Authorization: Bearer <CRON_SECRET>` in **constant
  time**, and refuse every request when the secret is missing — otherwise the
  literal `Bearer undefined` would be accepted.

## Tests must survive dependency upgrades

The suite is the gate for dependency PRs, so it must fail on real regressions
and not on harmless library changes.

- **Test through the app's own contracts**: tRPC procedures via `createCaller`,
  service effects through `run(...)` (`tests/helpers/run`, which maps failures
  like a procedure, so `expectTRPCError(run(…), code, key)` works), route
  handlers invoked with a `Request`, better-auth through `auth.api.*` or its
  HTTP handler. Effect-native tests use `@effect/vitest` (`it.effect`) with
  `AppLayer` provided. Never reach into library internals.
- **Assert on stable app-level values**: the error `code` plus the app's message
  key, returned data, and DB state. Never on a library's error text, Schema's
  issue wording, SQL strings, or third-party rendered markup.
- **No snapshot tests** of library-rendered output. For emails, assert the key
  facts are present, not the markup.
- **Inject time.** Never depend on the wall clock or the machine timezone.
  Effect's live `Clock` reads `Date.now()`, so `vi.useFakeTimers({ toFake: ["Date"] })`
  controls it; `it.effect` tests get `TestClock`. Doubles are layers
  (`Mailer.layerWith`, `AppConfig.layerWith`), never optional parameters.
