import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { Secret, TOTP } from "otpauth";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "~/server/db";
import {
  accounts,
  authAccounts,
  counterparties,
  invites,
  transactions,
  users,
} from "~/server/db/schema";
import { migrateFromV1 } from "~/server/migration/from-v1";
import { AuthSession } from "../helpers/auth-http";
import { callerFor } from "../helpers/caller";

const V1_DB = "zm_test_v1";
const adminUrl = process.env.DATABASE_URL ?? "";
const v1Url = adminUrl.replace(/\/zm_test(\?|$)/, `/${V1_DB}$1`);
const schemaSql = readFileSync(
  fileURLToPath(new URL("../fixtures/v1-schema.sql", import.meta.url)),
  "utf8",
);

let old: postgres.Sql;

const OTP_SECRET = new Secret({ size: 20 }).base32;
const UAH = "smea6nsp8t6nrofg7gul2ai6";

beforeAll(async () => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${V1_DB} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${V1_DB}`);
  await admin.end();

  old = postgres(v1Url, { max: 1, onnotice: () => undefined });
  await old.unsafe(schemaSql);
});

afterAll(async () => {
  await old.end();
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${V1_DB} WITH (FORCE)`);
  await admin.end();
});

beforeEach(async () => {
  await old.unsafe(`
    TRUNCATE users, currencies, accounts, accounts_users, categories,
      categories_users, transactions, planned_transactions, imports,
      history_logs, invites
  `);
  await old.unsafe(`
    INSERT INTO currencies (id, code, sign) VALUES
      ('smea6nsp8t6nrofg7gul2ai6', 'UAH', '₴'),
      ('toegx59plx5s345ddc8kilps', 'USD', '$'),
      ('p7pwusz57z3ndrzbkr2uvdgm', 'EUR', '€'),
      ('mby0x01v764is0rwfrfjegil', 'GBP', '£')
  `);

  const hash = await bcrypt.hash("old-password", 10);
  await old`
    INSERT INTO users (id, name, email, password, type, otp_secret, locale) VALUES
      ('u1', 'Olena', 'Olena@Example.com', ${hash}, 'admin', ${OTP_SECRET}, 'ua'),
      ('u2', null, 'gone@example.com', ${hash}, 'user', ${OTP_SECRET}, 'en')
  `;
  await old`UPDATE users SET deleted_at = now() WHERE id = 'u2'`;

  await old.unsafe(`
    INSERT INTO accounts (id, name, type, currency_id, initial_balance, current_balance, usage, created_by) VALUES
      ('a-cash', 'Cash', 'cash', '${UAH}', 1000, 999999, 3, 'u1'),
      ('a-card', 'Card', 'card', '${UAH}', 0, 5200, 1, 'u1'),
      ('a-debt', 'Борги', 'debt', '${UAH}', 0, 50, 1, 'u1');
    INSERT INTO accounts_users (account_id, user_id, can_read, can_write) VALUES
      ('a-cash', 'u1', true, true), ('a-card', 'u1', true, true), ('a-debt', 'u1', true, true);
    INSERT INTO categories (id, name, is_income, is_expense, created_by) VALUES
      ('c-food', 'Food', false, true, 'u1'),
      ('c-odd', 'Odd', false, false, 'u1');
    INSERT INTO categories_users (category_id, user_id, can_read, can_write) VALUES
      ('c-food', 'u1', true, true);
    INSERT INTO transactions (id, batch_id, date, amount, account_id, category_id, comment, payee, created_by) VALUES
      ('t-exp', null, '2025-01-10', -300, 'a-cash', 'c-food', '', 'Silpo', 'u1'),
      ('t-inc', null, '2025-01-11', 5000, 'a-card', null, 'pay', null, 'u1'),
      ('t-tr1', 'b-tr', '2025-01-12', -200, 'a-cash', null, null, null, 'u1'),
      ('t-tr2', 'b-tr', '2025-01-12', 200, 'a-card', null, null, null, 'u1'),
      ('t-db1', 'b-db', '2025-01-13', -100, 'a-cash', null, null, 'Alex', 'u1'),
      ('t-db2', 'b-db', '2025-01-13', 100, 'a-debt', null, null, 'Alex', 'u1'),
      ('t-db3', 'b-db2', '2025-01-14', 50, 'a-cash', null, null, 'alex ', 'u1'),
      ('t-db4', 'b-db2', '2025-01-14', -50, 'a-debt', null, null, 'alex ', 'u1'),
      ('t-zero', null, '2025-01-15', 0, 'a-cash', null, null, null, 'u1');
    INSERT INTO planned_transactions (id, start_date, repeat_type, repeat_interval, repeat_weekdays, amount, account_id, payee, created_by) VALUES
      ('p1', '2025-02-01', 'monthly', 1, '{3}', -700, 'a-card', 'Alex', 'u1');
    INSERT INTO history_logs (id, entity_type, entity_id, entity_action, user_id, payload) VALUES
      ('h1', 'accounts', 'a-cash', 'create', 'u1', '{}');
    INSERT INTO invites (id, otp_secret, user_id, created_by, comment) VALUES
      ('admin', '', 'u1', 'SYSTEM', null),
      ('${"x".repeat(48)}', '${OTP_SECRET}', null, 'u1', 'for a friend');
  `);
});

describe("migrateFromV1", () => {
  it("copies users with their bcrypt password and base32 authenticator", async () => {
    await migrateFromV1(old, db);

    const olena = await db.query.users.findFirst({ where: eq(users.id, "u1") });
    expect(olena).toMatchObject({
      email: "olena@example.com",
      role: "admin",
      locale: "uk",
      twoFactorEnabled: true,
    });

    // sign in exactly like v1: old password + a code from the old app
    const code = new TOTP({ secret: Secret.fromBase32(OTP_SECRET) }).generate();
    const browser = new AuthSession();
    await browser.post("/sign-in/email", {
      email: "olena@example.com",
      password: "old-password",
    });
    await browser.post("/two-factor/verify-totp", { code });
    expect((await browser.session())?.user.id).toBe("u1");

    // and the bcrypt hash was replaced after the successful sign-in
    const credential = await db.query.authAccounts.findFirst({
      where: eq(authAccounts.userId, "u1"),
    });
    expect(credential?.password?.startsWith("$2")).toBe(false);
  });

  it("moves a deleted user's email aside and fills a missing name", async () => {
    await migrateFromV1(old, db);

    const gone = await db.query.users.findFirst({ where: eq(users.id, "u2") });
    expect(gone).toMatchObject({
      name: "gone@example.com",
      email: "u2@deleted.invalid",
      deletedEmail: "gone@example.com",
      locale: "en",
    });
  });

  it("derives kinds, merges payees and reports what changed", async () => {
    const lines: string[] = [];
    const report = await migrateFromV1(old, db, (line) => lines.push(line));

    expect(report.kinds).toEqual({
      debt: 4,
      expense: 1,
      income: 1,
      transfer: 2,
    });

    const people = await db.select().from(counterparties);
    expect(people.map((p) => p.name).sort()).toEqual(["Alex", "Silpo"]);
    expect(report.mergedPayees).toEqual([
      { ownerId: "u1", kept: "Alex", variants: ["Alex", "alex"] },
    ]);

    const debtLegs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.kind, "debt"));
    expect(new Set(debtLegs.map((t) => t.counterpartyId)).size).toBe(1);

    const [expense] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, "t-exp"));
    expect(expense).toMatchObject({ comment: null, date: "2025-01-10" });

    expect(report.repairs).toEqual(
      expect.arrayContaining([
        "category c-odd: had neither flag, marked as expense",
        "transaction t-zero: unknown account/owner or zero amount, skipped",
      ]),
    );
    expect(report.counts).toContainEqual({
      table: "transactions → transactions",
      old: 9,
      new: 8,
    });
    expect(report.balanceMismatches).toEqual([
      { accountId: "a-cash", name: "Cash", old: 999999, new: 450 },
    ]);
    expect(
      lines.some((line) => line.startsWith("balance mismatch: Cash")),
    ).toBe(true);
  });

  it("keeps the app working on the migrated data", async () => {
    await migrateFromV1(old, db);
    const olena = await db.query.users.findFirst({ where: eq(users.id, "u1") });

    const list = await callerFor(olena ?? { id: "u1" }).accounts.list();
    expect(list.map((a) => [a.name, a.balance])).toEqual(
      expect.arrayContaining([
        ["Cash", 450],
        ["Card", 5200],
      ]),
    );

    const balances = await callerFor({ id: "u1" }).counterparties.balances();
    expect(balances).toMatchObject([{ counterpartyName: "Alex", sum: 50 }]);

    const debt = await db.query.accounts.findFirst({
      where: eq(accounts.id, "a-debt"),
    });
    expect(debt?.type).toBe("debt");
  });

  it("copies invites; an unclaimed one still registers with its old secret", async () => {
    await migrateFromV1(old, db);

    const rows = await db.select().from(invites);
    expect(rows.find((i) => i.id === "admin")).toMatchObject({
      userId: "u1",
      otpSecret: null,
    });

    const open = rows.find((i) => i.id === "x".repeat(48));
    expect(open?.otpSecret).toBe(`b32:${OTP_SECRET}`);
  });

  it("refuses a target that already has users", async () => {
    await migrateFromV1(old, db);

    await expect(migrateFromV1(old, db)).rejects.toThrow(/already has users/);
  });
});
