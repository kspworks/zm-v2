# ZM rewrite: functional specification

> **Kickoff prompt for the new Claude Code session**
>
> You are rebuilding "ZM", a self-hosted personal budget manager, from scratch in this empty repo. `docs/rewrite-spec.md` is the source of truth for *behaviour*. It describes what the app must do, its domain rules, edge cases and constraints, and deliberately leaves out UI design: design a clean, modern, mobile-friendly UI yourself with the latest shadcn/ui. Follow the stack and the milestones in the spec. Work milestone by milestone, and after each one run typecheck, `biome ci` and the test suite against a real Postgres. Where the spec marks something **[FIX]**, implement the corrected behaviour, not the legacy one. Where it marks **[NEW]**, the feature did not exist or was unfinished in the old app. Ask me before deviating from a domain rule.

## 1. Product summary

ZM is a multi-user, invite-only, self-hosted money tracker with these capabilities:
- Accounts in several currencies, with balances.
- Expense, income, transfer and debt transactions.
- Two-level categories.
- Recurring (planned) transactions, generated ahead of time, plus overdue reminders.
- Borrower (debt) tracking per counterparty.
- A CSV import of ZenMoney exports.
- A treemap spending report.
- Admin-managed invites.
- Email alerts when tomorrow's planned payments would overdraw an account.
- UI in English and Ukrainian, with dark and light themes.

Production runs as **more than one Node process** (pm2 cluster, 2 processes) and also on Vercel (serverless). Two consequences:
- **No in-process state.** Rate limits, locks and caches live in Postgres.
- **No read-then-write races.** Use single statements, row locks or advisory locks.

## 2. Stack

Kept: Next.js (latest, App Router, `proxy.ts`), TypeScript strict, tRPC v11, Drizzle ORM with `postgres` (postgres-js), PostgreSQL 15+, Tailwind v4, Zod 4, react-hook-form with `@hookform/resolvers`, date-fns v4 with `@date-fns/tz`, TanStack Query, superjson, Sentry (optional, DSN-gated), vitest.

Changes:

| Area | Old | New | Why |
|---|---|---|---|
| Auth | next-auth v4, JWT, a per-call DB re-check | **better-auth** with the `twoFactor` (TOTP) and `admin` plugins, database sessions | Real session revocation. Roles and bans come built in. Sign-up can be disabled (invite-only). |
| i18n | next-i18next plus a custom proxy, locale prefix in every URL | **next-intl without i18n routing** (locale from the user profile or a cookie, no URL prefix, typed messages) | Native to the App Router. Clean URLs. Removes the resource-loader and `callbackUrl` locale-rewriting workarounds. |
| Lint/format | ESLint + Prettier + Biome | **Biome only** | One tool, which the old repo already ran in CI. oxlint isn't needed alongside it. |
| UI kit | hand-copied shadcn + Radix | **latest shadcn/ui via CLI**, Sonner toasts, `next-themes` | Current components, system/light/dark theme. |
| Charts | @nivo/treemap + recharts (unused mock) | **shadcn charts (recharts)**, including `Treemap` | One chart library. |
| Email | nodemailer + `tw-to-css` class-inlining hack | nodemailer + **react-email** | Proper email rendering. |
| Filter state | zustand global stores | **nuqs** (URL search params) | Filters become shareable and survive reloads. |
| tRPC client | `@trpc/react-query` hooks | `@trpc/tanstack-react-query` (queryOptions proxy) | The current recommended integration. |
| Utilities | lodash, md5, bcrypt, js-base64, cuid2 | Native JS / `es-toolkit`, `node:crypto`, the better-auth hasher | Fewer dependencies. |

Tooling: pnpm, `drizzle-kit` migrations (generated and committed), `knip`, `@t3-oss/env-nextjs` for env validation. Coerce values again at the read site when `SKIP_ENV_VALIDATION` is set.

## 3. Global conventions

- **Money** is an integer in minor units (cents). The sign is relative to the account: negative means money left the account, positive means it arrived. Display with a thousands separator of a space ("1 234 567"), a period for decimals, and the currency sign after the number. Inputs accept `,` or `.` as the decimal separator, with at most 2 decimals and 9 integer digits.
- **Calendar dates** (transaction date, schedule start and end) are Postgres `date` columns handled as **`yyyy-MM-dd` strings end to end** (Drizzle `mode: "string"`). **[FIX]** This replaces the old `toCalendarDate` offset hack and the `+3h` shifts in import.
- **App timezone**: env `APP_TIMEZONE` (default `Europe/Kyiv`). It defines "today" for the server: overdue checks, cron "tomorrow", the planned horizon, and import timestamps.
- **Weeks start on Monday.** Weekday numbers are ISO 1 (Mon) to 7 (Sun).
- **Soft delete** (`deletedAt`) applies to users, accounts, categories, member rows, transactions and schedules. Every read filters `deletedAt IS NULL`. Uniqueness uses **partial unique indexes** `WHERE deleted_at IS NULL`, never a plain UNIQUE that includes `deleted_at`.
- **IDs** are text primary keys. Keep the old IDs verbatim during migration. Generate new ones with cuid2 or UUIDv7 (either is fine; be consistent).
- **Timestamps** are `createdAt` and `updatedAt` (auto) as `timestamptz`.
- **Audit log**: every create, update or delete of an account, category, transaction or schedule writes a `history_logs` row with entityType, entityId, action (`create|update|delete|restore`), userId and the JSON input payload. Write it in the same DB transaction as the change. **[FIX]** The old app wrote it separately. It is not shown in the UI.
- **Atomicity** **[FIX]**: every mutation and all of its side effects (paired legs, auto-created debt account, audit row, balance-affecting writes) run in one DB transaction. Services accept an optional transaction handle so they compose. Drizzle nests with SAVEPOINTs.
- **tRPC errors**: a business-rule violation throws `BAD_REQUEST` or `FORBIDDEN` with a **stable snake_case message key**, and the client translates the key. The keys are: `type_change_not_supported`, `fields_integrity_not_expense_category`, `fields_integrity_not_income_category`, `fields_integrity_same_account_transfer`, `fields_integrity_self_parent`, `fields_integrity_parent_not_allowed`, `fields_integrity_parent_has_parent`, `email_not_unique`, `invalid_otp`, `otp_attempts_exceeded`, `upload_count_exceeded`, `is_nonempty`, `weekdays_required`, `incorrect_weekday`, `start_date_lte_end_date`, `end_date_gte_start_date`, `is_minor_units`. Zod errors are flattened into `error.data.zodError`.
- In development only, a timing middleware adds a random 100–500 ms delay and logs `[TRPC] [Xms] path`. Logging is silent in tests.

## 4. Data model

The model has real foreign keys **[FIX]**; the old schema had none. Soft-deleted parents keep their rows, so use `ON DELETE RESTRICT` and soft-delete in application code.

- **currencies**: `id`, `code` (unique, e.g. UAH), `sign` (₴). Seeded by migration with fixed IDs: UAH ₴ `smea6nsp8t6nrofg7gul2ai6`, USD $ `toegx59plx5s345ddc8kilps`, EUR € `p7pwusz57z3ndrzbkr2uvdgm`, GBP £ `mby0x01v764is0rwfrfjegil`. Read-only in the app, ordered by code.
- **users**: from better-auth (`user`, `session`, `account`, `verification`, `twoFactor`), extended with `role` (`admin|user`, admin plugin), `locale` (`en|uk`, default `uk`), `banned`/soft delete, and `deletedAt`. The email is unique case-insensitively among active users (partial unique index on `lower(email)`).
- **accounts**: `name` (trimmed, ≤255), `type` enum `cash|card|account|credit|deposit|debt`, `currencyId`, `initialBalance` (int), `isActive` (default true), `importId?`, `createdBy`. Partial unique index on (`name`, `currencyId`, `createdBy`) for live rows.
  - **Balance and usage are derived** **[FIX]**. `balance = initialBalance + SUM(amount)` and `usage = COUNT(*)`, both over non-planned, non-deleted transactions of the account. Compute them in SQL on read (index `transactions(account_id) WHERE deleted_at IS NULL AND NOT is_planned`). The old cached `currentBalance`/`usage` and the "recalculate balances" button go away. If you ever cache them, update them inside the same transaction.
- **account_members** (was `accounts_users`): (`accountId`, `userId`, `canRead`, `canWrite`), with a partial unique index on the pair. The creator always gets read+write, in the same transaction as the account insert. An account without a member row would be invisible to everyone.
- **categories**: `parentId?`, `name` (trimmed), `isIncome`, `isExpense`, `importId?`, `createdBy`. Maximum depth 2.
- **category_members**: same shape as account_members.
- **transactions**:

  | Column | Notes |
  |---|---|
  | `id` | |
  | `kind` | **[NEW]** explicit enum `expense\|income\|transfer\|debt` (the old app inferred it) |
  | `batchId?` | shared by both legs of a transfer or debt |
  | `date` | date |
  | `amount` | int, ≠ 0 |
  | `accountId` | |
  | `categoryId?` | |
  | `comment?` | ≤500, trimmed, empty → null |
  | `counterpartyId?` | FK → counterparties; required for debts (replaces the old free-text `payee`) |
  | `plannedTransactionId?` | |
  | `plannedHash?` | |
  | `isPlanned` | bool |
  | `importId?` | |
  | `createdBy`, `createdAt` | `createdAt` is the tie-break for ordering |

  Indexes: `date`, `accountId`, `categoryId`, `batchId`, `counterpartyId`, `comment`, `plannedTransactionId`, `plannedHash`, `isPlanned`, `importId`.
- **counterparties** **[NEW]** (payees and borrowers): `id`, `ownerId` (user), `name` (trimmed, ≤255), timestamps, `deletedAt`. Partial unique index on (`ownerId`, `lower(name)`) for live rows.
  - Why a table rather than the old free-text `payee`: it isn't mainly about speed, although grouping and joining on a key is cheaper than grouping by text, and autocomplete reads a small table instead of scanning transactions. The real gains are **correctness** (case and typo variants of one person no longer split their debt balance), **rename and merge** in one place, and a clean partition key for the debt-wording algorithm (section 14).
  - The form's payee field is a create-or-select combobox: typing a new name creates the counterparty on save (case-insensitive match against existing names first). It is optional for expense and income, hidden for transfers, and required for debts.
  - A small **Counterparties** management view **[NEW]** lists them with their per-currency debt balance and allows rename, merge (repoint all transactions and schedules, then soft-delete the source) and delete (only when unused).
- **planned_transactions** (schedules): `batchId?`, `kind`, `startDate`, `endDate?`, `repeatType` `daily|weekly|monthly|yearly`, `repeatInterval` smallint 1–31, `repeatWeekdays` smallint[] (non-empty iff weekly, else `[]`), `amount`, `accountId`, `categoryId?`, `comment?`, `counterpartyId?` (same FK, same rules as transactions), `createdBy`.
- **imports**: `userId`, `fileName`, `createdAt`, `deletedAt?`.
- **invites**: `id` (48-char random, or the literal `admin`), `otpSecret` (cleared on use), `comment` (≤255), `userId?` (set when claimed), `createdBy` (`SYSTEM` for the admin bootstrap), timestamps.
- **recovery_links** **[NEW]**: `id`, `userId`, `tokenHash`, `scope` (`password|twoFactor|both`), `createdBy`, `expiresAt`, `usedAt?`, `revokedAt?`, `createdAt`.
- **rate_limits** (was `auth_attempts`): `key` PK, `count`, `windowStart`. This is a fixed-window counter shared by all limiters (section 12). better-auth's own rate limiter must also use database storage, never memory.
- **history_logs**: see conventions.

## 5. Authentication, invites and sessions

- **Invite-only.** Public sign-up is disabled. Every user is created by the invite registration procedure.
- **Admin bootstrap.** The invite id `admin` is valid **only while there are zero active (non-deleted, non-banned) admins**. Its invite row is created on demand the first time a QR code is requested. Soft-deleted admins don't count, so deleting the last admin re-opens the bootstrap.
- **Registration wizard** (public page `/auth/register/invite?id=…`):
  1. `invites.validate(id)` checks the invite: unclaimed, or `admin` while no admin exists. An invalid invite gets FORBIDDEN, and the page shows the error with no retry.
  2. The user enters **name** (3–255), **email**, **password** (≥6). `invites.makeOtpQR` re-validates the invite, checks the email is unique (case-insensitive, active users; `email_not_unique`), and returns a QR data-URL for TOTP (issuer `ZM`, label = email, SHA1, 6 digits, 30 s) built from the invite's **pre-generated secret**. Also show the secret as text so it can be typed in manually. **[NEW]**
  3. The user enters the 6-digit OTP. `invites.register` re-validates the invite and email, checks the OTP (±1 step window), and is rate-limited to **10 attempts per 15 min per invite** (`otp_attempts_exceeded`). Then, **in one transaction**:
     - Create the user. The role is admin if the invite is `admin`, else user. Set the password hash, enable TOTP with the invite's secret, and store `locale` from the current UI locale.
     - Claim the invite (set `userId`, clear `otpSecret`).
     - Seed the user's accounts: one `cash`-type account named the localized "Cash" per active currency, balance 0.
     - Seed the user's categories with localized names (below).
  4. Done: a button signs the user in and lands on `/transactions`.
  5. Show the **backup codes** (better-auth `twoFactor`) once, with copy and download. The user must confirm they saved them before continuing. **[NEW]**
- **Seed categories** (key → en / uk), as expense (E), income (I) or both:

  | Key | English | E/I |
  |---|---|---|
  | adjustment | Adjustment | E+I |
  | animals | Pets | E |
  | car | Car | E |
  | clothing | Clothing, shoes, accessories | E |
  | commuting | Commuting | E |
  | devices | Personal devices | E |
  | entertainment | Recreation and entertainment | E |
  | gifts | Gifts | E |
  | groceries | Groceries | E |
  | health | Health and fitness | E |
  | home | House (apartment) | E |
  | income | Income | I |
  | salary | Salary | I |
  | self_care | Self-care | E |
  | subscriptions | Subscriptions and online payments | E |

  Take the Ukrainian strings from `src/locales/ua/categories.json` in the old repo, and the "Cash" and "Debts" names from `src/locales/*/accounts.json`.
- **Login** takes email, password and TOTP code. better-auth's two-factor flow (password first, then TOTP) is acceptable as a two-step UI. Rules:
  - Rate limit: **10 attempts per 15 min, keyed by lowercased email** (not IP, which can be spoofed). Reset on success.
  - A rate-limit hit is reported as "Too many sign-in attempts, wait a few minutes". A DB or infrastructure failure is reported as "Service temporarily unavailable" and is never shown as "wrong credentials". Log it and send it to Sentry.
  - Error codes shown on the login page come from an **allow-list**: `CredentialsSignin`, `TooManyRequests`, `ServiceUnavailable`, `Default`. Unknown codes fall back to `Default`, and raw error text never reaches the URL or page.
  - In `development` only, the OTP `111111` is always accepted.
- **Sessions** last 14 days and are DB-backed. Deleting or banning a user, or changing a role, takes effect on the next request. Every protected procedure resolves the *current* user and role from the DB session.
- **Procedures**: `public`, `protected` (active user) and `admin` (role = admin). An unauthenticated call gets `UNAUTHORIZED`.
- **Proxy / route gate**: everything except the public auth pages (`/auth/login`, `/auth/register/invite`, `/auth/reset`, `/auth/recover`), `/api/*`, static assets and Sentry tunnel routes requires a session cookie. Otherwise redirect to `/auth/login?callbackUrl={path}{query}`. `callbackUrl` must be a same-origin relative path; anything else is replaced with `/transactions`. `/` redirects to `/transactions`.
- The login, invite and recovery pages have a **language switcher**. It sets the locale cookie and re-renders in place; the URL doesn't change.

### 5.1 Account recovery and credential management **[NEW]**

The old app had none of this. Rules:
- **A password reset never removes 2FA**, and a 2FA reset never skips the password, unless an admin-issued recovery link explicitly covers both. Every successful reset or re-enrolment **revokes all of the user's other sessions** and writes an audit row.
- **Self-service, in the signed-in user's settings page:**
  - Change password: requires the current password and a current TOTP code.
  - Re-enrol the authenticator: requires the password and a current TOTP or backup code. Show the new QR code and secret, and confirm with a code from the new secret before switching.
  - Regenerate backup codes: requires the password and a TOTP code. The old codes stop working.
- **Lost authenticator**: the login's second step accepts a **backup code** in place of the TOTP. Each code works once. After signing in with one, prompt the user to re-enrol.
- **Forgot password (email)**: available only when SMTP is configured (hide the link otherwise). The user enters an email and always sees the same "if the address exists, a link was sent" answer, so addresses can't be enumerated. The single-use link expires in 1 hour (better-auth `forgetPassword` / `resetPassword`). The reset page asks for the new password **and** a TOTP or backup code. Rate-limit requests per email (3 per hour) and reset submissions per token.
- **Admin-issued recovery link**, for when SMTP isn't configured or the user lost both the password and the authenticator:
  - On the Users page, the admin picks "Create recovery link" for a user and chooses the scope: password, 2FA, or both.
  - It creates a single-use token that expires in 24 h (stored hashed). The admin sees `{origin}/auth/recover?token=…` once, to copy, the same way as invite links.
  - The recovery page walks through the chosen steps: a new password (≥6), and/or a fresh TOTP enrolment with QR code, confirmation code and new backup codes. OTP attempts are rate-limited like invites (10 per 15 min per token).
  - Unused links can be revoked. Creating a new link revokes the user's previous unused one.

## 6. Locales

- The locales are `en` and `uk` (the old code used `ua`; the migration maps `ua → uk`). The default is `uk`.
- **URLs carry no locale.** Use next-intl's "without i18n routing" setup: `i18n/request.ts` resolves the locale for each request, and no `[locale]` segment exists.
- Resolution order: the signed-in user's stored `locale`, then the `NEXT_LOCALE` cookie (1 year), then `Accept-Language` (q-sorted, matching the base tag), then the default.
- Switching language sets the cookie and, when signed in, also updates `user.locale` through a procedure. The profile then follows the user across devices and drives emails. After sign-in, if the cookie and the profile disagree, the profile wins and the cookie is rewritten.
- Registration stores the locale that is active on the invite page.
- Trade-off, accepted: pages can't be statically prerendered per locale, and search engines see one language per URL. Neither matters, because every page except the auth pages is behind a login and dynamic anyway.
- **Server-side rendering outside a request** (debt account name, seed names, emails) uses the **user's stored locale**, never a guess.
- date-fns locales: `en → enGB`, `uk → uk`. The display date format is `dd.MM.yyyy`; lists use `d MMMM` (plus `yyyy` if not the current year).

## 7. Access control

Access control is per entity, via member tables.
- **Reads** of accounts, categories and transactions are scoped to rows where the user has `canRead` on the account (transactions) or the category (categories list). The accounts list returns `canWrite` per row, and so does the categories list.
- **Account write** (update, toggle active, delete) needs `canWrite`, and the account must **not be of type `debt`**. Debt accounts are system-managed.
- **Category write** needs `canWrite`.
- **Transaction create** needs write access to `accountId`, to `linkedAccountId` if present, and to `categoryId` if present.
- **Transaction update** needs delete rights on the existing row *and* create rights on the new values.
- **Transaction delete** needs write access to the row's account and category (if any). If the row is batched, it also needs write access to the linked leg's account and category.
- **Parent category** must exist, be readable by the user, and not itself have a parent. For every failure, return one `fields_integrity_parent_not_allowed` answer so that IDs can't be probed.
- **Sharing** **[NEW]**: the owner (a member with write) of an account or category can share it with another *existing* user by email, as read-only or read+write, and can list and revoke shares. Accounts shared with you appear in your lists and selects with an owner hint. Debt accounts cannot be shared. The transactions of a shared account are visible to every member.

## 8. Accounts

- **List**: all readable non-debt accounts, sorted by `usage` desc. Each row shows name, type, currency code, balance, active or inactive (inactive rows dimmed), an "imported" badge if `importId` is set, usage count and a shared indicator.
- **Create** takes name (required), currency (required), type (any except debt; default `card`), initial balance (signed decimal, default 0) and active (default true). Trim the name. A duplicate live (name, currency, owner) hits the unique index, so return a friendly error.
- **Update** changes the same fields. **[FIX]** Changing the currency is forbidden once the account has transactions.
- **Activate / deactivate.** Inactive accounts are hidden from transaction-form selects, filter options and the balances sidebar. They stay selectable when editing a transaction that already uses them, with an "(inactive)" hint.
- **Delete** is a soft delete with confirmation. **[FIX]** Allow it only when the account has no live transactions; otherwise suggest deactivating. The old app hid all of the account's transactions silently.
- **Debt accounts**: at most one live `debt` account per (user, currency), created automatically the first time that user records a debt in that currency. It is named the localized "Debts" in the **creating user's locale**. It is never listed on the Accounts page, never offered in selects, and shown as "Debts" wherever it appears.

## 9. Categories

- **List**: readable categories sorted by the display name `Parent / Child` (locale compare). Each row shows name (with a parent prefix), the expense and income flags, an "imported" badge and a shared indicator.
- **Create/update** takes name (required, trimmed), parent (optional; only top-level categories other than itself are offered), isExpense (default true) and isIncome (default false). A category that has children cannot be given a parent; hide the parent field. At least one of the flags must be set **[FIX]**.
- **Delete** is a soft delete with confirmation. **[FIX]** Deleting a parent that has live children is forbidden. Transactions that point to a deleted category show "Deleted category"; the old app showed an endless spinner.
- **Select options** everywhere: parents plus children, children labelled `Parent → Child`, sorted by that label.
- **Category search** in selects is **keyboard-layout-agnostic**. The search text is also tried transliterated EN↔UK by *physical key position* (typing `ghj` finds `про`). Port both mapping strings from `src/lib/utils.tsx` (`makeKeyboardLayouts`).

## 10. Transactions

### 10.1 Kinds and storage

| Kind | Rows | Rules |
|---|---|---|
| expense | 1 | amount < 0. If a category is set, it must have `isExpense` (`fields_integrity_not_expense_category`). |
| income | 1 | amount > 0. If a category is set, it must have `isIncome`. |
| transfer | 2, same `batchId` | Leg A: `amount` < 0 on `accountId`. Leg B: `linkedAmount` > 0 on `linkedAccountId`. The accounts must differ (`fields_integrity_same_account_transfer`). The amounts may differ (cross-currency). No category and no counterparty. |
| debt | 2, same `batchId` | A counterparty (the borrower or lender) is required. Leg A: signed amount on the user's real account. Leg B: **the negated amount** on the user's auto-created debt account for that account's currency. "I gave" (lent, or repaid my debt) makes leg A negative. "I took" (borrowed, or got repaid) makes leg A positive. No category. |

- The shared fields are date (required), amount (≠0), account (required, and never the "no selection" placeholder), comment (optional), and the counterparty (required for debts, optional for expense and income). Comment and counterparty are copied to both legs.
- **Primary leg.** For list, filter and total purposes, a batched pair is shown as **one row**: the leg with `amount < 0` is primary, and the other leg is attached as `linked`.
- **Editing cannot change the kind** (`type_change_not_supported`). Update both legs together; a debt edit re-resolves the debt account.
- **Editing a planned occurrence** (`isPlanned = true`) through the regular update procedure **submits** it: set `isPlanned = false` and `createdAt = now`.
- **Delete** soft-deletes the row and every other live row in its batch.

### 10.2 Queries

The input is a shared filter object with these fields:
- `accounts[]`: matches either leg.
- `categories[]`: matches either leg. The special value `"null"` means "no category", which only matches non-batched rows without a category.
- `startDate`/`endDate` (inclusive): each matches either leg. `start ≤ end` is required, with an error on the offending field.
- `amount` (a positive decimal): matches `|amount|` on either leg. **[FIX]** If the value has no decimals, match any amount whose whole-unit part equals it: `100` matches 100.00–100.99, which was the old intent. If it has decimals, match exact cents.
- `counterparties[]`: multi-select of counterparty IDs, matching either leg. Replaces the old payee substring filter.
- `comment`: case-insensitive substring, on either leg.
- `cursor`.

Procedures:
- **Submitted list** (`isPlanned = false`): newest first (`date desc, createdAt desc`), page size `TRANSACTIONS_PAGINATION_LIMIT` (env, default 50), "load more" (fetch limit + 1 to detect a next page).
- **Planned list** (`isPlanned = true`): oldest first (`date asc, createdAt asc`), paginated the same way. Each row includes its `schedule` (the planned_transactions row), if it has one.
- **Overdue planned**: `isPlanned = true AND date ≤ today`, filtered the same way, capped at 50. It is shown in a highlighted "Planned and overdue" block above the submitted list, and each row offers **Submit with changes** and **Delete**.
- **Report data**: submitted rows over the whole range, capped at 100 000, fetching limit + 1 to detect truncation (section 15).
- **Filtered totals** **[FIX]** are computed **server-side over the whole filtered set**, not only the loaded pages. They show Expenses, Incomes and Total per currency, hide zero lines, and are displayed only while a filter is active. Rules:
  - Exclude transfers between two of the user's own non-debt accounts, which net to zero.
  - Keep legs that touch a debt account. For a debt pair whose primary leg is the debt-account row, count the real-account leg instead.
  - Show the tooltip "These results do not include transfers between your own accounts".

### 10.3 Transaction form (behavioural requirements)

- The fields are date (a calendar; default today), kind (tabs: Expense, Income, Transfer, Debt; default Expense), amount (with a sign indicator and the selected account's currency sign), category (single select filtered by kind: expense → `isExpense`, income → `isIncome`; hidden for transfer and debt), account, linked account and linked amount (transfer only), counterparty (a create-or-select combobox; required for debt, optional for expense and income, hidden for transfer), and comment.
- **Debt context hint**: once a counterparty is picked on the Debt tab, show the current balance with them per currency (e.g. "Alex owes you 500 ₴"), and a preview of how this entry will be labelled (section 14.1).
- **Debt direction toggle**: "I gave" / "I took". When editing, it is initialised from which leg sits on the debt account.
- **Account options**: non-debt accounts that are active (plus the ones the edited transaction already uses), sorted by usage desc. When creating, preselect the first one. Linked-account options exclude the currently selected source account, with the first one preselected. If the user has no accounts, show a "Create account" link instead of the select.
- **The linked amount mirrors the amount** as the amount is typed, and can then be edited for cross-currency transfers.
- **Ctrl/Cmd+Enter submits** from any field.
- **After a create**, reset amount, linked amount, comment and counterparty, keep everything else, and refocus amount.
- **After an edit**, close the form.
- **Success toast** shows date (or date range for schedules), category, comment, signed amount with currency, and account.
- **Warning toast** if a create leaves the account balance below zero: `Account "X" has negative balance`.
- **Error toast** shows the translated message key for 15 s.
- Once the form is dirty, "Close" becomes "Cancel".
- **Keyboard**: the counterparty combobox supports ↑/↓/Enter. The category select supports Tab and Shift+Tab to move to the neighbouring fields.

### 10.4 Transactions page

- An "Add transaction" entry point opens the form. There are also **[NEW] Bulk entry** and **[NEW] Balance adjustment** entry points:
  - **Bulk entry**: add several transactions in one go, in grid-like rows that share defaults for date and account. They are submitted in one call and inserted in one DB transaction.
  - **Balance adjustment**: pick an account and enter its actual current balance. The app creates one expense or income transaction for the difference, in the seeded "Adjustment" category (or with no category if that was deleted), with the comment "Balance adjustment". A zero difference creates nothing.
- The filter bar is backed by URL params. Text inputs are debounced 500 ms, and a field with a validation error doesn't apply.
- The list is grouped by day, with the date shown once per day. Each row shows:
  - **Date**, with a relative label: today, yesterday or tomorrow within ±1 day. Otherwise the weekday name for submitted rows, and "in N days" / "N days ago" for planned rows.
  - **Description**:
    - A debt shows the **exact label computed server-side** (section 14.1): "I lent to Alex", "I borrowed from Alex", "I repaid Alex", "Alex repaid me", or a split such as "Alex repaid me 300 ₴ · I borrowed 200 ₴". There is no ambiguous alternate wording.
    - Otherwise: "Transfer" for a batch, then `Parent → Child`, then "No category". A counterparty on an expense or income is shown next to the category.
  - **A recurring icon** if the row came from a schedule. Its tooltip describes the schedule in words, localized with ICU plurals, for example:
    - "Repeats every month" / "Repeats every 2 weeks on Mon and Thu" / "Repeats every day"
    - plus "until 01.05.2027" when there is an end date.

    Build it from `repeatType`, `repeatInterval`, `repeatWeekdays` and `endDate` with a pure `describeSchedule(schedule, locale)` helper, which has unit tests.
  - **Comment** (clamped to one line; the full text in a tooltip past 50 chars).
  - **Amount.** Negate it for display if the primary leg is on the debt account. Hide the +/− sign when both legs are on accounts of the same type with equal absolute amounts. Show the linked amount on a second line when the absolute amounts differ.
  - **Account names**: "A" or "A → B".
- Row actions:
  - **Submitted**: Edit and Delete (confirm Yes/No).
  - **Planned**: Submit with changes (opens the form pre-filled, and saving submits it), Edit schedule **[NEW]** (only when the row is recurring), Delete.
    - A **recurring** row's delete asks "Only this one" or "All planned".
    - A **non-recurring** planned row (repeat = none) gets a plain Yes/No confirmation, the same as a submitted row.
- An empty state points to "Add transaction" (if accounts exist) or "Create an account", plus "or import CSV".
- A **balances sidebar** appears on the Transactions and Planned pages:
  - "Available" per currency: the sum of balances of active non-debt accounts, zero currencies omitted.
  - "My debt" and "Owe to me" totals per currency.
  - The account list (active, non-debt, sorted by usage) with balances. **Clicking an account toggles it in the account filter**; selected accounts are highlighted with a remove affordance.
  - Per-borrower lists for "My debt" and "Owe to me".

## 11. Planned transactions (schedules)

- The **create form** is the transaction form plus these fields:
  - Repeat: none, daily, weekly, monthly or yearly (default none).
  - Interval: 1–31, shown as "Every N days/weeks/months/years".
  - Weekdays: for weekly only, at least one (`weekdays_required`), each in 1..7. The default is today's weekday.
  - End date: optional ("No ending date").

  The start date is the form's date.
- **Repeat = none** creates the transaction row(s) with `isPlanned = true` and no schedule. That is a one-off future or reminder payment.
- **Repeating**: create one schedule row per leg (two, with a shared `batchId`, for transfer or debt), and then generate occurrences **in the same transaction** **[FIX]**. Only the primary schedule (no batch, or `amount < 0`) drives generation.
- **Occurrence generation** is idempotent:
  - The horizon is `min(endDate, today + 1 year)`.
  - Iterate `d = startDate; d ≤ horizon; d += interval × unit`, where the unit is days, weeks, months or years (date-fns `addDays`/`addWeeks`/`addMonths`/`addYears`).
  - For weekly, each step emits, for every selected weekday, that weekday within the Monday-started week of `d`, if it is ≥ startDate **and ≤ horizon**. **[FIX]** The old code overshot endDate inside the last week.
  - Each occurrence has the hash `md5(date + primaryScheduleId)`, and only missing hashes are inserted. This includes hashes of occurrences that were already submitted or deleted, so submitting or deleting an occurrence never makes it come back.
  - Each occurrence copies amount, account, category, comment, counterparty and createdBy from the schedule, and for pairs the linked schedule's fields too, as a batched pair. It gets `isPlanned = true` and **both legs carry `plannedTransactionId = primary schedule id`**.
- **Nightly job** (00:00 in `APP_TIMEZONE`) re-runs generation for every live primary schedule, so the 1-year window rolls forward. It also sweeps rate-limit rows older than 24 h.
- **Delete "All planned"** from an occurrence:
  1. Soft-delete that occurrence.
  2. Soft-delete the schedule and all schedules in its batch.
  3. Soft-delete every remaining `isPlanned = true` occurrence of those schedules. Already-submitted occurrences stay.
- **Delete "Only current"** is a normal delete of that occurrence (and its pair).
- **Edit schedule** **[NEW]**:
  - Editable: amount, linked amount, account, linked account, category, comment, counterparty, repeat type, interval, weekdays, start date and end date. The kind stays fixed.
  - Saving updates both schedule legs, soft-deletes all *un-submitted future* occurrences (`isPlanned AND date ≥ today`), and regenerates, all in one transaction.
  - Overdue (past) un-submitted occurrences are kept.
- **Insufficient-funds email** (daily at 09:00, `APP_TIMEZONE`):
  1. For **tomorrow**, sum the amounts of live planned occurrences per account.
  2. For each such account and **every user with read access to it**, if `balance + plannedSum < 0`, build a section with account name, date, planned amount, current balance and shortage (`plannedSum + balance`), in that user's locale.
  3. Send **one email per recipient**, combining their sections. The subject is "Insufficient funds for planned transactions", from `ZM Notifications <MAIL_FROM or MAIL_USERNAME>`.
  4. Skip everything, with a log line, if SMTP env is missing. Log per recipient whether the mail was sent, rejected or failed; one failure doesn't stop the others.
  5. SMTP uses the configured host and port with TLS. Never use a nodemailer `service` preset, which silently overrides the host.

## 12. Rate limiting and throttles

All limits live in Postgres, as a fixed-window counter in **one atomic upsert** that returns the post-increment count:
`INSERT … ON CONFLICT (key) DO UPDATE SET count = CASE WHEN window expired THEN 1 ELSE count+1 END, windowStart = CASE …`

- Login: key `login:email:<lowercased>`, 10 per 15 min, reset on success.
- Invite OTP: key `invite:otp:<inviteId>`, 10 per 15 min.
- Import: 1 successful import per user per hour (count `imports` rows in the last hour; `upload_count_exceeded`, TOO_MANY_REQUESTS).
- Password-reset requests: key `reset:email:<lowercased>`, 3 per hour.
- Recovery-link OTP: key `recover:otp:<tokenId>`, 10 per 15 min.
- Cron sweep: delete windows older than 24 h.

## 13. CSV import (ZenMoney export)

- **Upload**: the client sends the file as base64 (at most **256 KB**) plus the file name. The CSV is parsed with a header on **line 2** (line 1 is skipped) and empty lines skipped.
- **Columns** (all strings, with `""` meaning null): `date` (`yyyy-MM-dd`), `categoryName` (`"Parent"` or `"Parent / Child"`), `payee`, `comment` (≤500), `outcomeAccountName`, `outcome`, `outcomeCurrencyShortTitle`, `incomeAccountName`, `income`, `incomeCurrencyShortTitle`, `createdDate` and `changedDate` (`yyyy-MM-dd HH:mm:ss`).
- **Amounts** use a comma decimal with exactly 2 places and no thousands separator (`"3000,00"`). Stripping the comma gives minor units. Reject a value that isn't an integer after stripping (`is_minor_units`), because a dot-decimal file would otherwise land 100× too small.
- **Currency codes** must exist in `currencies`. Validate the whole file first and return row-level errors.
- **Debt currency fix**: if `income == outcome`, the currencies differ, and one side's account name maps to a debt account, set the debt side's currency to the other side's. Log it.
- **Account type from name** (case-insensitive): `долги`, `борги`, `debts` → debt; `наличные`, `готівка`, `cash` → cash; anything else → card.
- **Everything below runs in one DB transaction**:
  1. Create an `imports` row.
  2. Create categories. Parents are sorted by name, and children sorted within each parent. A category's `isExpense`/`isIncome` flags are set if any of its rows has outcome > 0 or income > 0.
  3. Create one account per distinct (name, currency) with the inferred type and initial balance 0.
  4. Create transactions per row:
     - An outcome-only row becomes an expense (`-outcome`).
     - An income-only row becomes an income.
     - A row with both becomes a batched pair. It is a transfer, or a debt if either account is a debt account, and the kind is set accordingly.
     - A row with neither aborts the import.
  5. Resolve `payee` to a counterparty (create-or-match, case-insensitive, trimmed) and attach it to both legs.
  6. Set the category from the full `categoryName`. Set `createdAt` from `createdDate` interpreted in `APP_TIMEZONE`. **[FIX]** No `+3h` shifts; dates stay plain `date` strings.
- On success, redirect to Transactions.
- **Import history and undo** **[NEW]**, replacing the dev-only admin "clear imports": the Import page lists the user's imports (file name, date, counts). "Undo import" (with confirmation) soft-deletes that import and every account, category and transaction it created, in one transaction.

## 14. Counterparties and debts

- `counterparties.balances` covers transactions on readable **debt** accounts: non-planned and non-deleted. It groups them by (counterparty, currency), sums the amounts, and orders by sum desc.
- A positive sum means **they owe me**; a negative sum means **I owe them**. The debt-account leg is the mirror of the real-account leg, so "I gave" adds to their balance and "I took" subtracts.
- It feeds the balances sidebar ("My debt", "Owe to me" and the per-person lists) and the Counterparties view.

### 14.1 Debt wording: deciding "lent / borrowed / repaid" **[NEW]**

The old UI could only tell the *direction* of the money, so it showed "I borrowed / or repaid to me" and left the user to guess. The ambiguity goes away once you know the **running balance with that counterparty, in that currency, just before the entry**.

Let `B` be the balance before the entry (positive means they owe me) and `X > 0` the entry's absolute amount.

| Direction | `B` before | Label |
|---|---|---|
| **I gave** X (my account −X) | `B ≥ 0` | **I lent** X |
| | `B ≤ −X` | **I repaid** X |
| | `−X < B < 0` | Split: **I repaid** \|B\|, **I lent** X − \|B\| |
| **I took** X (my account +X) | `B ≤ 0` | **I borrowed** X |
| | `B ≥ X` | **They repaid me** X |
| | `0 < B < X` | Split: **they repaid me** B, **I borrowed** X − B |

If the entry settles the balance exactly, add a "settled" marker.

Implementation rules:
- Compute it **on read, in SQL**, never stored, so that backdated entries, edits and deletes relabel the later rows automatically. Over the debt-account legs, use a window function: `SUM(amount) OVER (PARTITION BY counterparty_id, currency_id ORDER BY date, created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)`. Return `debtLabel` as `{ parts: [{ kind: "lent"|"borrowed"|"repaid"|"repaidToMe", amount }], settles: boolean }`, which the client translates.
- **Ordering** is `date`, then `createdAt`, then `id`. Same-day entries are therefore ordered by entry time, which matches how the user recorded them.
- **Planned occurrences** are labelled against the *projected* balance: submitted history plus the earlier planned occurrences, in order. The label reads as a forecast ("will lend", "will repay").
- The window runs over the whole history of the counterparty, not the filtered page. Filtering must not change a label, so compute the label in a CTE before the list filters are applied.
- Imported debt rows get the same treatment. Old records created without a counterparty (null) keep the plain direction wording ("Gave" / "Took").
- Cover it with unit tests: each table row, splits, exact settlement, a backdated insert that relabels later rows, and multiple currencies with the same person.

## 15. Reports **[NEW, enabled in nav]**

- The filter bar is the same as on Transactions. The date range is required and can't be cleared; the default is 1 month ago to today.
- Show **one treemap per currency**, never summing across currencies. The largest total comes first, with a currency header when there is more than one.
- The data is submitted rows in range, **excluding own-account transfers** (same rule as the totals).
- **[FIX]** Expense and income get separate views (tabs); the old app summed their absolute values together. Within a view:
  - Top-level tiles are categories, with **children rolled up under their parent**, plus "No category". Each tile is labelled "Name — total".
  - Leaf tiles are individual transactions, with a tooltip showing date, category, amount and comment. Zero-total categories are hidden.
  - The header reads "Total: X sign".
- If the result exceeds 100 000 rows, show a warning ("showing the first 100 000 transactions") instead of silently charting a partial period.

## 16. Admin

The Users page is admin-only, with an admin-only menu entry.
- **Invites table**: comment, claimed user (id and name), creator, created and updated. Unclaimed invites offer **Copy link** (`{origin}/auth/register/invite?id=…`, with a toast) and **Delete** (confirm).
- **Create invite**: a dialog with a required comment (≤255). It generates a 48-char id and a TOTP secret.
- **Users table**: id, name, email, created, updated, deleted, role. **[NEW]** An admin can soft-delete or ban and restore a user, and promote or demote the role (never the last admin). The better-auth admin plugin covers this. An admin can also create and revoke **recovery links** (section 5.1) and revoke all of a user's sessions.
- The admin sees the build id and environment in the user menu.

## 17. Shell and UX-level requirements

- Nav: Transactions, Planned, Reports, Accounts, Categories and Import. The Users entry is admin-only.
- The user menu has name and email, a language switch (sets the cookie and profile, then refreshes in place), a theme switch (system/light/dark, persisted; default dark), a **Settings** entry (password, authenticator, backup codes; section 5.1), and logout.
- A "DEV" badge appears when no build id is set.
- `NEXT_PUBLIC_BUILD_ID` is set at build time as `yy.M.d`.
- There is a localized 404 page and a global error page that reports to Sentry.

## 18. HTTP routes and cron

- `/api/trpc/[trpc]` and `/api/auth/[...all]` (better-auth).
- `/api/cron/daily-0000` (planned generation and rate-limit sweep) and `/api/cron/daily-0900` (insufficient-funds email):
  - They are `GET` handlers requiring `Authorization: Bearer ${CRON_SECRET}`, compared in **constant time**.
  - `CRON_SECRET` is required (≥16 chars). If it is missing at runtime, **refuse every request**, because the literal `Bearer undefined` would otherwise be accepted.
  - The response is `text/plain` with log lines like `[CRON] [name] yyyy-MM-dd HH:mm:ss - text` plus the total duration.
  - They are dynamic, with no caching.
- The Vercel `vercel.json` crons are `0 0 * * *` and `0 9 * * *`. They are UTC on Vercel, so document the offset against `APP_TIMEZONE` or schedule the jobs in UTC accordingly. Self-hosted installs use system cron or curl.

## 19. Environment

`DATABASE_URL`, `DATABASE_LOG` (compare to the string `"true"`), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (falls back to `VERCEL_URL`), `CRON_SECRET`, `TRANSACTIONS_PAGINATION_LIMIT` (default 50), `APP_TIMEZONE`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM?`, `SENTRY_ORG?`, `SENTRY_PROJECT?`, `NEXT_PUBLIC_SENTRY_DSN?`, `NEXT_PUBLIC_SENTRY_ENV?`, `NEXT_PUBLIC_BUILD_ID?`. Treat empty strings as undefined. `SKIP_ENV_VALIDATION` exists for Docker builds, and numbers must be coerced again at the read site when it is set.

## 20. Deployment

- `output: "standalone"`. The `build:selfhosted` script assembles `dist/` (standalone + `public` + `.next/static`).
- **Docker compose**: `postgres` (healthcheck), then `migrator` (a target that runs `drizzle-kit migrate` and must exit 0), then `next-app`, on port 3333→3000. Ship an example env and warn that the example Postgres password is public.
- **Vercel**: `vercel-build` = build + migrate. Neon Postgres. Port the old repo's `SELF-HOSTING.md` (step-by-step Vercel guide) and README, updated for the new env names.
- **Multi-process safety**: the optional "migrate on boot" escape hatch (a `RUN_MIGRATIONS` sentinel file) must take a Postgres **advisory lock** and delete the sentinel only on success. It is never run during `next build`.
- CI (GitHub Actions and GitLab): install, `biome ci`, typecheck, tests against a Postgres service, build. Deploys go through the GitLab pipeline to a pm2 cluster over SSH (port the old `.gitlab-ci.yml`).

## 21. Tests

- vitest against a **real Postgres**: a `docker-compose.test.yml` on port 5433 with tmpfs, migrated once by global setup, with every table except `currencies` truncated between tests. Config comes from `.env.test`, and real env vars override it (for CI).
- Call procedures through the tRPC `createCaller` with a fabricated session context. Keep fixtures helpers for users, accounts, categories and transactions.
- The **minimum coverage** mirrors the old suite (≈270 cases). The main areas:
  - Auth guards on every procedure (anonymous, user and admin).
  - Account, category and transaction permission matrices, including shared read-only.
  - Integrity rules: category kinds, same-account transfer, parent rules, type change.
  - Transfer and debt pairing, and debt-account auto-creation per currency and user.
  - Balances after create, update (including account swaps on either leg), delete and submit.
  - Filters: each field, either-leg matching, the no-category sentinel, and amount semantics.
  - Pagination cursors.
  - Planned generation: each repeat type, weekly weekdays and endDate, idempotency, horizon, and delete-all.
  - Insufficient-funds selection, including shared accounts notifying every member.
  - The rate-limit upsert under concurrency.
  - Invites: the admin bootstrap only while there are no admins, email uniqueness case-insensitively, OTP limits, and registration atomicity.
  - CSV parse and validate, the debt currency fix, account type from name, import atomicity (a failure leaves nothing behind), throttle and undo.
  - Cron auth (missing secret, wrong secret, constant-time comparison).
  - Locale resolution (profile, cookie, header, default), `callbackUrl` same-origin sanitising, and the auth error allow-list.
  - Report chart builder.
  - Email rendering.
  - Recovery: password change, re-enrolment, backup codes, email reset (with SMTP mocked), admin recovery links (scope, expiry, single use, session revocation).
  - Counterparties: create-or-match, merge, the debt-wording algorithm (section 14.1), and `describeSchedule`.

### 21.1 Tests must survive dependency upgrades

Dependabot opens weekly grouped minor and patch PRs plus separate majors, and `npm-check-updates` runs locally. The suite is the gate for merging those PRs. It must fail on real regressions and **must not fail on harmless library changes**. Rules:
- **Test through the app's own contracts**: tRPC procedures via `createCaller`, service functions, route handlers invoked with a `Request`, and better-auth through its public `auth.api.*` or HTTP handler. **Never reach into library internals.** The old suite had to read next-auth's `provider.options.authorize` because the config stored a stub; design the code so this is never needed.
- **Assert on stable app-level values**: error `code` plus the app's message key, returned data, and DB state. Never assert on a library's error text, Zod's issue wording, SQL strings, or the rendered HTML of third-party components.
- **No snapshot tests** of library-rendered output. For emails, assert that the key facts (account, date, amounts) are present in the text, not the markup.
- **Time is injected**: services take a `now()` clock or tests use `vi.useFakeTimers({ toFake: ["Date"] })`. Never depend on the wall clock or on the machine timezone. Run the suite with `TZ=UTC`, and also run the date tests with `APP_TIMEZONE` set to a non-UTC zone.
- **Isolation**: real Postgres, truncate between tests, no shared state between files. Configure postgres-js with `idle_timeout` so forked workers exit, as the old CI does.
- **Build-level checks run in CI on every dependency PR**, not only unit tests:
  1. `pnpm install --frozen-lockfile`
  2. `biome ci`
  3. `tsc --noEmit`
  4. vitest
  5. `next build`
  6. a **standalone smoke test**: port the old `smoke-standalone.sh`. It boots `dist/server.js`, requests a *rendered* public page (`/auth/login`, which is not a redirect-only path), and checks that runtime-traced assets such as locale and email files are in the bundle. It exists because a dependency bump once shipped a bundle that couldn't load its own modules.
  7. `drizzle-kit migrate` on an empty DB, plus a `drizzle-kit check` that the committed migrations match the schema.
- A small **contract test per critical integration** gives a clear, local failure when a major bump changes behaviour: better-auth sign-in with TOTP, next-intl locale resolution, the tRPC superjson round-trip of `Date`, and the nodemailer transport options (host and port respected, no `service` preset).
- Keep the Dependabot config (grouped minor/patch, separate majors, the `@types/node` pin kept in sync with `.ncurc.json`) and the "PRs only" GitHub CI workflow with its read-only token.

## 22. Migration script (old DB → new DB)

Write a standalone script, `scripts/migrate-from-v1.ts`. It takes `OLD_DATABASE_URL` and `DATABASE_URL`, targets an empty, migrated new DB, runs in one transaction, and is idempotent (it refuses if the target already has users).
- **currencies**: match by id and code.
- **users**:
  - Copy id, name, email, role (`type`), locale (`ua → uk`), createdAt and deletedAt.
  - Put the bcrypt password hash into the better-auth credential `account` row. Configure better-auth `password.verify` to accept bcrypt hashes (and rehash on successful login), or keep bcrypt as the hasher.
  - Create the `twoFactor` row from `otp_secret`, **encrypted the way better-auth stores it** (its symmetric encryption with `BETTER_AUTH_SECRET`), set `twoFactorEnabled = true`, and generate backup codes.
  - Skip the next-auth tables `auth_accounts`, `auth_sessions` and `auth_verification_tokens`, and skip `auth_attempts`.
- **accounts**: copy them and drop `current_balance`/`usage`. **accounts_users** → account_members.
- **categories** and **categories_users** → category_members.
- **transactions**: copy them and derive `kind`:
  - No batch: `amount < 0` → expense, else income.
  - Batched: debt if either leg's account is `debt`, else transfer.
  - Normalise an empty comment to null.
  - **payee → counterparty**: for each owner (the transaction's `created_by`), collect the distinct trimmed payees, merge them case-insensitively (keep the most-used spelling), create `counterparties` rows, and set `counterpartyId`. Do the same for `planned_transactions.payee`. Report the merged variants so the user can review them.
- **planned_transactions**: derive `kind` the same way. **imports** and **history_logs** are copied as-is. **invites** are copied, including claimed ones, for history.
- **Verification output**: row counts per table, old vs new. For every account, the old `current_balance` vs the new derived balance (report mismatches without failing). And a count of transactions per kind.

## 23. Milestones for the implementer

0. Scaffold: Next.js, TS strict, Biome, Tailwind v4, shadcn init, next-intl (en, uk), env schema, Drizzle config, vitest and the test DB, CI.
1. Schema and migrations (including the currency seed), better-auth (credentials + TOTP + admin plugin, sign-up disabled), the rate_limits table, invites plus the registration wizard (with backup codes), login (including backup codes), the proxy gate, and cookie/profile-based locale resolution.
2. Accounts, categories, counterparties, member tables and sharing, and the audit log.
3. Transactions core: the four kinds, the debt account, integrity and permission middlewares, derived balances, queries and filters, server-side totals, counterparty balances, debt wording (14.1), and the Transactions page with the sidebar.
4. Planned: schedules, generation, delete-all, edit schedule, the Planned page, the overdue block, and the cron routes.
5. Bulk entry and balance adjustment.
6. CSV import, import history and undo.
7. Reports.
8. Admin users and invites, recovery links, and the user settings page (section 5.1).
9. Insufficient-funds and password-reset emails (react-email).
10. The migration script from v1.
11. Docker, Vercel and pm2 deploy docs, the Sentry wiring, the standalone smoke test, and the Dependabot CI gate (section 21.1).

Each milestone ends green: typecheck, `biome ci`, tests, and `next build`.

