import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  type PgColumn,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/*
 * Conventions (see AGENTS.md):
 * - money is a bigint in minor units (mode "number": safe up to 2^53)
 * - calendar dates are `date` columns handled as "yyyy-MM-dd" strings
 * - soft delete via deletedAt, uniqueness via partial indexes on live rows
 * - real foreign keys, ON DELETE RESTRICT (parents are soft-deleted in code)
 */

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => createId());

const tz = () => timestamp({ withTimezone: true, mode: "date" });

const createdAt = () => tz().notNull().defaultNow();

const updatedAt = () =>
  tz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const money = () => bigint({ mode: "number" });

const calendarDate = () => date({ mode: "string" });

const restrict = { onDelete: "restrict", onUpdate: "cascade" } as const;
const cascade = { onDelete: "cascade", onUpdate: "cascade" } as const;

const live = (column: PgColumn) => sql`${column} IS NULL`;

// ---------------------------------------------------------------------------
// better-auth tables (model names are mapped in src/server/auth/index.ts)
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // twoFactor plugin
    twoFactorEnabled: boolean().notNull().default(false),
    // admin plugin
    role: text().notNull().default("user"),
    banned: boolean().notNull().default(false),
    banReason: text(),
    banExpires: tz(),
    // app fields
    locale: text().notNull().default("uk"),
    deletedAt: tz(),
    /**
     * A soft-deleted user's address moves here and `email` gets a unique
     * placeholder, so the address can be reused by a new invite while
     * better-auth's plain-equality email lookup still finds exactly one user.
     */
    deletedEmail: text(),
  },
  (t) => [
    uniqueIndex("users_email_live_uq")
      .on(sql`lower(${t.email})`)
      .where(live(t.deletedAt)),
    check("users_role_ck", sql`${t.role} IN ('admin', 'user')`),
    check("users_locale_ck", sql`${t.locale} IN ('en', 'uk')`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    expiresAt: tz().notNull(),
    token: text().notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => users.id, cascade),
    impersonatedBy: text(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** better-auth's "account" model: credentials, not money accounts */
export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: id(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, cascade),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: tz(),
    refreshTokenExpiresAt: tz(),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: tz().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const twoFactors = pgTable(
  "two_factors",
  {
    id: id(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, cascade),
    verified: boolean().notNull().default(true),
    failedVerificationCount: integer().notNull().default(0),
    lockedUntil: tz(),
  },
  (t) => [
    index("two_factors_user_id_idx").on(t.userId),
    index("two_factors_secret_idx").on(t.secret),
  ],
);

/** better-auth's own rate limiter (database storage, never memory) */
export const authRateLimits = pgTable("auth_rate_limits", {
  id: id(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: "number" }).notNull(),
});

// ---------------------------------------------------------------------------
// app tables
// ---------------------------------------------------------------------------

export const currencies = pgTable("currencies", {
  id: text().primaryKey(),
  code: text().notNull().unique(),
  sign: text().notNull(),
});

export const accountTypeEnum = pgEnum("account_type", [
  "cash",
  "card",
  "account",
  "credit",
  "deposit",
  "debt",
]);

export const transactionKindEnum = pgEnum("transaction_kind", [
  "expense",
  "income",
  "transfer",
  "debt",
]);

export const repeatTypeEnum = pgEnum("repeat_type", [
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

export const historyActionEnum = pgEnum("history_action", [
  "create",
  "update",
  "delete",
  "restore",
]);

export const recoveryScopeEnum = pgEnum("recovery_scope", [
  "password",
  "twoFactor",
  "both",
]);

export const imports = pgTable(
  "imports",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, restrict),
    fileName: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [index("imports_user_id_created_at_idx").on(t.userId, t.createdAt)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    name: varchar({ length: 255 }).notNull(),
    type: accountTypeEnum().notNull(),
    currencyId: text()
      .notNull()
      .references(() => currencies.id, restrict),
    initialBalance: money().notNull().default(0),
    isActive: boolean().notNull().default(true),
    importId: text().references(() => imports.id, restrict),
    createdBy: text()
      .notNull()
      .references(() => users.id, restrict),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [
    uniqueIndex("accounts_name_currency_owner_live_uq")
      .on(t.name, t.currencyId, t.createdBy)
      .where(live(t.deletedAt)),
    // at most one live debt account per (user, currency)
    uniqueIndex("accounts_debt_owner_currency_live_uq")
      .on(t.createdBy, t.currencyId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.type} = 'debt'`),
    index("accounts_import_id_idx").on(t.importId),
  ],
);

export const accountMembers = pgTable(
  "account_members",
  {
    id: id(),
    accountId: text()
      .notNull()
      .references(() => accounts.id, restrict),
    userId: text()
      .notNull()
      .references(() => users.id, restrict),
    canRead: boolean().notNull().default(true),
    canWrite: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [
    uniqueIndex("account_members_live_uq")
      .on(t.accountId, t.userId)
      .where(live(t.deletedAt)),
    index("account_members_user_id_idx").on(t.userId),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: id(),
    parentId: text().references((): PgColumn => categories.id, restrict),
    name: varchar({ length: 255 }).notNull(),
    isIncome: boolean().notNull().default(false),
    isExpense: boolean().notNull().default(true),
    /** Set on categories seeded at registration, e.g. "adjustment" */
    seedKey: text(),
    importId: text().references(() => imports.id, restrict),
    createdBy: text()
      .notNull()
      .references(() => users.id, restrict),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [
    index("categories_parent_id_idx").on(t.parentId),
    index("categories_import_id_idx").on(t.importId),
    check("categories_kind_ck", sql`${t.isIncome} OR ${t.isExpense}`),
    check("categories_not_self_parent_ck", sql`${t.parentId} <> ${t.id}`),
  ],
);

export const categoryMembers = pgTable(
  "category_members",
  {
    id: id(),
    categoryId: text()
      .notNull()
      .references(() => categories.id, restrict),
    userId: text()
      .notNull()
      .references(() => users.id, restrict),
    canRead: boolean().notNull().default(true),
    canWrite: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [
    uniqueIndex("category_members_live_uq")
      .on(t.categoryId, t.userId)
      .where(live(t.deletedAt)),
    index("category_members_user_id_idx").on(t.userId),
  ],
);

export const counterparties = pgTable(
  "counterparties",
  {
    id: id(),
    ownerId: text()
      .notNull()
      .references(() => users.id, restrict),
    name: varchar({ length: 255 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [
    uniqueIndex("counterparties_owner_name_live_uq")
      .on(t.ownerId, sql`lower(${t.name})`)
      .where(live(t.deletedAt)),
  ],
);

export const plannedTransactions = pgTable(
  "planned_transactions",
  {
    id: id(),
    batchId: text(),
    kind: transactionKindEnum().notNull(),
    startDate: calendarDate().notNull(),
    endDate: calendarDate(),
    repeatType: repeatTypeEnum().notNull(),
    repeatInterval: smallint().notNull().default(1),
    repeatWeekdays: smallint().array().notNull().default(sql`'{}'`),
    amount: money().notNull(),
    accountId: text()
      .notNull()
      .references(() => accounts.id, restrict),
    categoryId: text().references(() => categories.id, restrict),
    comment: varchar({ length: 500 }),
    counterpartyId: text().references(() => counterparties.id, restrict),
    createdBy: text()
      .notNull()
      .references(() => users.id, restrict),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [
    index("planned_transactions_batch_id_idx").on(t.batchId),
    index("planned_transactions_account_id_idx").on(t.accountId),
    check("planned_transactions_amount_ck", sql`${t.amount} <> 0`),
    check(
      "planned_transactions_interval_ck",
      sql`${t.repeatInterval} BETWEEN 1 AND 31`,
    ),
    check(
      "planned_transactions_weekdays_ck",
      sql`(${t.repeatType} = 'weekly') = (cardinality(${t.repeatWeekdays}) > 0)
        AND ${t.repeatWeekdays} <@ '{1,2,3,4,5,6,7}'::smallint[]`,
    ),
    check(
      "planned_transactions_dates_ck",
      sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`,
    ),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    kind: transactionKindEnum().notNull(),
    batchId: text(),
    date: calendarDate().notNull(),
    amount: money().notNull(),
    accountId: text()
      .notNull()
      .references(() => accounts.id, restrict),
    categoryId: text().references(() => categories.id, restrict),
    comment: varchar({ length: 500 }),
    counterpartyId: text().references(() => counterparties.id, restrict),
    plannedTransactionId: text().references(
      () => plannedTransactions.id,
      restrict,
    ),
    plannedHash: text(),
    isPlanned: boolean().notNull().default(false),
    importId: text().references(() => imports.id, restrict),
    createdBy: text()
      .notNull()
      .references(() => users.id, restrict),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [
    index("transactions_date_idx").on(t.date),
    index("transactions_account_id_idx").on(t.accountId),
    index("transactions_category_id_idx").on(t.categoryId),
    index("transactions_batch_id_idx").on(t.batchId),
    index("transactions_counterparty_id_idx").on(t.counterpartyId),
    index("transactions_comment_idx").on(t.comment),
    index("transactions_planned_transaction_id_idx").on(t.plannedTransactionId),
    index("transactions_planned_hash_idx").on(t.plannedHash),
    index("transactions_is_planned_idx").on(t.isPlanned),
    index("transactions_import_id_idx").on(t.importId),
    // derived balances and usage read exactly this subset
    index("transactions_balance_idx")
      .on(t.accountId)
      .where(sql`${t.deletedAt} IS NULL AND NOT ${t.isPlanned}`),
    check("transactions_amount_ck", sql`${t.amount} <> 0`),
  ],
);

export const invites = pgTable("invites", {
  // 48 random chars, or the literal "admin" for the bootstrap invite
  id: text().primaryKey(),
  otpSecret: text(),
  comment: varchar({ length: 255 }).notNull().default(""),
  userId: text().references(() => users.id, restrict),
  // a user id, or "SYSTEM" for the admin bootstrap, hence no foreign key
  createdBy: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const recoveryLinks = pgTable(
  "recovery_links",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, restrict),
    tokenHash: text().notNull().unique(),
    scope: recoveryScopeEnum().notNull(),
    createdBy: text()
      .notNull()
      .references(() => users.id, restrict),
    expiresAt: tz().notNull(),
    usedAt: tz(),
    revokedAt: tz(),
    createdAt: createdAt(),
  },
  (t) => [index("recovery_links_user_id_idx").on(t.userId)],
);

/** Fixed-window counters shared by every app limiter */
export const rateLimits = pgTable("rate_limits", {
  key: text().primaryKey(),
  count: integer().notNull(),
  windowStart: tz().notNull(),
});

export const historyLogs = pgTable(
  "history_logs",
  {
    id: id(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    action: historyActionEnum().notNull(),
    userId: text().notNull(),
    payload: jsonb().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("history_logs_entity_idx").on(t.entityType, t.entityId)],
);
