import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import {
  accounts,
  categories,
  counterparties,
  imports,
  transactions,
} from "~/server/db/schema";
import { callerFor } from "../helpers/caller";
import {
  buildCsv,
  type CsvRow,
  csvText,
  encodeCsv,
  expenseRow,
} from "../helpers/csv";
import { expectTRPCError } from "../helpers/errors";
import {
  CURRENCY,
  createUser,
  makeAccount,
  type TestUser,
} from "../helpers/fixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const upload = (user: TestUser, rows: CsvRow[], fileName = "zen.csv") =>
  callerFor(user).imports.upload({ fileName, content: buildCsv(rows) });

const live = <T>(rows: T[]) => rows;

describe("imports.upload", () => {
  it("creates categories, accounts and transactions from the file", async () => {
    const user = await createUser();

    const summary = await upload(user, [
      expenseRow({
        categoryName: "Home / Repair",
        outcome: "250,50",
        comment: "paint",
        payee: "Epicentr",
      }),
      expenseRow({ categoryName: "Food", outcomeAccountName: "Готівка" }),
      {
        categoryName: "Salary",
        incomeAccountName: "Card",
        income: "30000,00",
        incomeCurrencyShortTitle: "UAH",
      },
    ]);

    expect(summary).toMatchObject({
      transactions: 3,
      accounts: 2,
      categories: 4,
    });

    const cats = await db
      .select()
      .from(categories)
      .where(eq(categories.importId, summary.importId));
    const byName = new Map(cats.map((c) => [c.name, c]));
    expect(byName.get("Repair")?.parentId).toBe(byName.get("Home")?.id);
    expect(byName.get("Home")).toMatchObject({
      isExpense: true,
      isIncome: false,
    });
    expect(byName.get("Salary")).toMatchObject({
      isExpense: false,
      isIncome: true,
    });

    const accs = await db
      .select()
      .from(accounts)
      .where(eq(accounts.importId, summary.importId));
    expect(accs.map((a) => [a.name, a.type, a.initialBalance]).sort()).toEqual([
      ["Card", "card", 0],
      ["Готівка", "cash", 0],
    ]);

    const rows = await db.select().from(transactions);
    const repair = rows.find((r) => r.comment === "paint");
    expect(repair).toMatchObject({
      kind: "expense",
      amount: -25_050,
      categoryId: byName.get("Repair")?.id,
      date: "2025-01-15",
      importId: summary.importId,
    });

    const [payee] = await db.select().from(counterparties);
    expect(payee?.name).toBe("Epicentr");
    expect(repair?.counterpartyId).toBe(payee?.id);

    const salary = rows.find((r) => r.kind === "income");
    expect(salary?.amount).toBe(3_000_000);
  });

  it("reads createdDate as local time in APP_TIMEZONE, with no shifts", async () => {
    const user = await createUser();

    await upload(user, [expenseRow({ createdDate: "2025-01-15 10:30:00" })]);

    const [row] = await db.select().from(transactions);
    // Europe/Kyiv is UTC+2 in January
    expect(row?.createdAt.toISOString()).toBe("2025-01-15T08:30:00.000Z");
    expect(row?.date).toBe("2025-01-15");
  });

  it("stores a two-sided row as a transfer pair", async () => {
    const user = await createUser();

    await upload(user, [
      {
        outcomeAccountName: "Card",
        outcome: "4100,00",
        outcomeCurrencyShortTitle: "UAH",
        incomeAccountName: "Dollars",
        income: "100,00",
        incomeCurrencyShortTitle: "USD",
      },
    ]);

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (r) => r.kind === "transfer" && r.batchId === rows[0]?.batchId,
      ),
    ).toBe(true);
    expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([
      -410_000, 10_000,
    ]);
  });

  it("stores debt rows on the user's debt account, with the payee as counterparty", async () => {
    const user = await createUser({ locale: "en" });

    await upload(user, [
      {
        payee: "Alex",
        outcomeAccountName: "Cash",
        outcome: "100,00",
        outcomeCurrencyShortTitle: "USD",
        incomeAccountName: "Долги",
        income: "100,00",
        // wrong in the export: fixed to USD
        incomeCurrencyShortTitle: "UAH",
      },
    ]);

    const debt = await db.query.accounts.findFirst({
      where: eq(accounts.type, "debt"),
    });
    expect(debt).toMatchObject({
      currencyId: CURRENCY.USD,
      name: "Debts",
      importId: null,
    });

    const rows = await db.select().from(transactions);
    expect(
      rows.every((r) => r.kind === "debt" && r.counterpartyId !== null),
    ).toBe(true);
    expect(rows.find((r) => r.accountId === debt?.id)?.amount).toBe(10_000);

    const balances = await callerFor(user).counterparties.balances();
    expect(balances).toMatchObject([
      { counterpartyName: "Alex", currencyCode: "USD", sum: 10_000 },
    ]);
  });

  it("reuses an existing account with the same name and currency", async () => {
    const user = await createUser();
    const existing = await makeAccount(user, {
      name: "Card",
      currencyId: CURRENCY.UAH,
    });

    const summary = await upload(user, [expenseRow()]);

    expect(summary.accounts).toBe(0);
    const [row] = await db.select().from(transactions);
    expect(row?.accountId).toBe(existing.id);
  });

  it("returns row-level errors and writes nothing", async () => {
    const user = await createUser();
    const error = await expectTRPCError(
      upload(user, [
        expenseRow(),
        expenseRow({ outcome: "1.00" }),
        expenseRow({ outcomeCurrencyShortTitle: "BTC" }),
      ]),
      "BAD_REQUEST",
      "import_invalid",
    );

    expect((error.cause as unknown as { rows: unknown }).rows).toEqual([
      { line: 4, field: "outcome", key: "is_minor_units" },
      { line: 5, field: "outcomeCurrencyShortTitle", key: "unknown_currency" },
    ]);
    expect(await db.select().from(imports)).toEqual([]);
  });

  it("imports a file well past the old 256 KB limit", async () => {
    const user = await createUser();
    const rows = Array.from({ length: 3200 }, (_, i) =>
      expenseRow({ comment: `row ${i}` }),
    );
    expect(Buffer.byteLength(csvText(rows))).toBeGreaterThan(256 * 1024);

    await expect(upload(user, rows)).resolves.toMatchObject({
      transactions: 3200,
    });
  });

  it("refuses files over 4 MB once decompressed", async () => {
    const user = await createUser();
    // compresses to a few KB, so it passes the router cap and trips the
    // decoder's bounded output instead
    const huge = encodeCsv("a".repeat(5 * 1024 * 1024));

    await expectTRPCError(
      callerFor(user).imports.upload({ fileName: "big.csv", content: huge }),
      "BAD_REQUEST",
      "import_invalid",
    );
  });

  it("refuses a payload that is not gzipped", async () => {
    const user = await createUser();

    await expectTRPCError(
      callerFor(user).imports.upload({
        fileName: "plain.csv",
        content: Buffer.from(csvText([expenseRow()])).toString("base64"),
      }),
      "BAD_REQUEST",
      "import_invalid",
    );
  });

  it("allows one import per hour", async () => {
    const user = await createUser();
    await upload(user, [expenseRow()]);

    await expectTRPCError(
      upload(user, [expenseRow({ outcomeAccountName: "Other" })]),
      "TOO_MANY_REQUESTS",
      "upload_count_exceeded",
    );

    vi.setSystemTime(new Date("2026-03-15T13:00:01Z"));
    await expect(
      upload(user, [expenseRow({ outcomeAccountName: "Other" })]),
    ).resolves.toBeTruthy();
  });

  it("throttles per user", async () => {
    await upload(await createUser(), [expenseRow()]);

    await expect(
      upload(await createUser(), [expenseRow()]),
    ).resolves.toBeTruthy();
  });

  describe("atomicity", () => {
    afterEach(async () => {
      await db.execute("DROP TRIGGER IF EXISTS fail_tx_insert ON transactions");
      await db.execute("DROP FUNCTION IF EXISTS fail_tx_insert()");
    });

    it("leaves nothing behind when a late step fails", async () => {
      const user = await createUser();
      await db.execute(`
        CREATE FUNCTION fail_tx_insert() RETURNS trigger AS $$
        BEGIN
          IF NEW.comment = 'boom' THEN RAISE EXCEPTION 'injected'; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql
      `);
      await db.execute(`
        CREATE TRIGGER fail_tx_insert BEFORE INSERT ON transactions
        FOR EACH ROW EXECUTE FUNCTION fail_tx_insert()
      `);

      await expect(
        upload(user, [
          expenseRow({ payee: "Shop" }),
          expenseRow({ comment: "boom" }),
        ]),
      ).rejects.toThrow();

      expect(await db.select().from(imports)).toEqual([]);
      expect(await db.select().from(accounts)).toEqual([]);
      expect(await db.select().from(categories)).toEqual([]);
      expect(await db.select().from(counterparties)).toEqual([]);
      expect(await db.select().from(transactions)).toEqual([]);

      // and a failed import doesn't count against the hourly limit
      await db.execute("DROP TRIGGER fail_tx_insert ON transactions");
      await expect(upload(user, [expenseRow()])).resolves.toBeTruthy();
    });
  });
});

describe("imports.list and imports.undo", () => {
  it("lists the user's imports with counts", async () => {
    const user = await createUser();
    await upload(
      user,
      [
        expenseRow(),
        {
          outcomeAccountName: "Card",
          outcome: "10,00",
          outcomeCurrencyShortTitle: "UAH",
          incomeAccountName: "Savings",
          income: "10,00",
          incomeCurrencyShortTitle: "UAH",
        },
      ],
      "march.csv",
    );

    expect(await callerFor(user).imports.list()).toMatchObject([
      { fileName: "march.csv", transactions: 2, accounts: 2, categories: 1 },
    ]);
    expect(await callerFor(await createUser()).imports.list()).toEqual([]);
  });

  it("undo soft-deletes everything the import created", async () => {
    const user = await createUser();
    const kept = await makeAccount(user, { name: "Card" });
    const summary = await upload(user, [
      expenseRow({ outcomeAccountName: "Card" }),
      expenseRow({ outcomeAccountName: "New one", categoryName: "Fun" }),
    ]);

    const result = await callerFor(user).imports.undo({ id: summary.importId });

    expect(result).toEqual({ transactions: 2, accounts: 1, categories: 2 });
    expect(
      live(
        await db
          .select()
          .from(transactions)
          .where(isNull(transactions.deletedAt)),
      ),
    ).toEqual([]);
    const accountsLeft = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.createdBy, user.id), isNull(accounts.deletedAt)));
    expect(accountsLeft.map((a) => a.id)).toEqual([kept.id]);
    expect(await callerFor(user).imports.list()).toEqual([]);
  });

  it("only the owner can undo", async () => {
    const user = await createUser();
    const summary = await upload(user, [expenseRow()]);

    await expectTRPCError(
      callerFor(await createUser()).imports.undo({ id: summary.importId }),
      "NOT_FOUND",
    );
  });
});
