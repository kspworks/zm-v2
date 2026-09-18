import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import {
  accountMembers,
  accounts,
  historyLogs,
  plannedTransactions,
} from "~/server/db/schema";
import { getOrCreateDebtAccount } from "~/server/services/accounts";
import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import {
  CURRENCY,
  createUser,
  grant,
  insertTransactionRow,
  makeAccount,
} from "../helpers/fixtures";

const input = {
  name: "  Main card  ",
  currencyId: CURRENCY.UAH,
  type: "card" as const,
  initialBalance: 12_345,
  isActive: true,
};

describe("accounts.create", () => {
  it("trims the name, adds the creator as read+write member and audits", async () => {
    const user = await createUser();
    const account = await callerFor(user).accounts.create(input);

    expect(account).toMatchObject({
      name: "Main card",
      type: "card",
      initialBalance: 12_345,
      createdBy: user.id,
    });

    const [member] = await db
      .select()
      .from(accountMembers)
      .where(eq(accountMembers.accountId, account.id));
    expect(member).toMatchObject({
      userId: user.id,
      canRead: true,
      canWrite: true,
    });

    const logs = await db
      .select()
      .from(historyLogs)
      .where(eq(historyLogs.entityId, account.id));
    expect(logs).toMatchObject([
      { entityType: "account", action: "create", userId: user.id },
    ]);
  });

  it("defaults the type to card, balance to 0 and active to true", async () => {
    const user = await createUser();
    const account = await callerFor(user).accounts.create({
      name: "Wallet",
      currencyId: CURRENCY.USD,
    });

    expect(account).toMatchObject({
      type: "card",
      initialBalance: 0,
      isActive: true,
    });
  });

  it("refuses the debt type", async () => {
    const user = await createUser();

    await expectTRPCError(
      // @ts-expect-error: debt accounts are system-managed
      callerFor(user).accounts.create({ ...input, type: "debt" }),
      "BAD_REQUEST",
    );
  });

  it("reports a duplicate (name, currency, owner) as a friendly error", async () => {
    const user = await createUser();
    await callerFor(user).accounts.create(input);

    await expectTRPCError(
      callerFor(user).accounts.create(input),
      "BAD_REQUEST",
      "account_name_not_unique",
    );

    // another currency, or another owner, is fine
    await callerFor(user).accounts.create({
      ...input,
      currencyId: CURRENCY.EUR,
    });
    await callerFor(await createUser()).accounts.create(input);
  });

  it("allows reusing the name of a deleted account", async () => {
    const user = await createUser();
    const first = await callerFor(user).accounts.create(input);
    await callerFor(user).accounts.delete({ id: first.id });

    await expect(callerFor(user).accounts.create(input)).resolves.toBeTruthy();
  });

  it("rejects amounts beyond 9 integer digits", async () => {
    const user = await createUser();

    await expectTRPCError(
      callerFor(user).accounts.create({
        ...input,
        initialBalance: 100_000_000_000,
      }),
      "BAD_REQUEST",
    );
  });
});

describe("accounts.list", () => {
  it("derives balance and usage from submitted, live transactions", async () => {
    const user = await createUser();
    const account = await makeAccount(user, { initialBalance: 1000 });

    await insertTransactionRow({
      accountId: account.id,
      amount: -300,
      createdBy: user.id,
    });
    await insertTransactionRow({
      accountId: account.id,
      amount: 500,
      createdBy: user.id,
    });
    // planned and deleted rows don't count
    await insertTransactionRow({
      accountId: account.id,
      amount: -100_000,
      isPlanned: true,
      createdBy: user.id,
    });
    await insertTransactionRow({
      accountId: account.id,
      amount: -100_000,
      deletedAt: new Date(),
      createdBy: user.id,
    });

    const [row] = await callerFor(user).accounts.list();

    expect(row).toMatchObject({
      id: account.id,
      balance: 1200,
      usage: 2,
      canWrite: true,
      isOwn: true,
      isShared: false,
      currencyCode: "UAH",
      currencySign: "₴",
    });
  });

  it("sorts by usage, most used first", async () => {
    const user = await createUser();
    const rare = await makeAccount(user, { name: "Rare" });
    const busy = await makeAccount(user, { name: "Busy" });

    for (let i = 0; i < 3; i++) {
      await insertTransactionRow({
        accountId: busy.id,
        amount: -1,
        createdBy: user.id,
      });
    }
    await insertTransactionRow({
      accountId: rare.id,
      amount: -1,
      createdBy: user.id,
    });

    const rows = await callerFor(user).accounts.list();

    expect(rows.map((row) => row.name)).toEqual(["Busy", "Rare"]);
  });

  it("excludes debt accounts and other users' accounts", async () => {
    const user = await createUser();
    const other = await createUser();
    await makeAccount(user, { name: "Mine" });
    await makeAccount(other, { name: "Theirs" });
    await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, user.id, CURRENCY.UAH),
    );

    const rows = await callerFor(user).accounts.list();

    expect(rows.map((row) => row.name)).toEqual(["Mine"]);
  });

  it("shows accounts shared with the user, with the owner", async () => {
    const owner = await createUser({ name: "Olena" });
    const reader = await createUser();
    const account = await makeAccount(owner, { name: "Family" });
    await grant("account", account.id, reader);

    const [row] = await callerFor(reader).accounts.list();

    expect(row).toMatchObject({
      name: "Family",
      ownerName: "Olena",
      isOwn: false,
      isShared: true,
      canWrite: false,
    });

    const [ownerRow] = await callerFor(owner).accounts.list();
    expect(ownerRow?.isShared).toBe(true);
  });

  it("hides accounts whose member row can't read", async () => {
    const owner = await createUser();
    const user = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, user, { canRead: false });

    expect(await callerFor(user).accounts.list()).toEqual([]);
  });
});

describe("accounts.update", () => {
  it("updates the fields and audits", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    await callerFor(user).accounts.update({
      id: account.id,
      ...input,
      name: "Renamed",
      type: "cash",
    });

    const row = await db.query.accounts.findFirst({
      where: eq(accounts.id, account.id),
    });
    expect(row).toMatchObject({ name: "Renamed", type: "cash" });

    const logs = await db
      .select()
      .from(historyLogs)
      .where(
        and(
          eq(historyLogs.entityId, account.id),
          eq(historyLogs.action, "update"),
        ),
      );
    expect(logs).toHaveLength(1);
  });

  it("needs write access", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const stranger = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, reader);

    for (const user of [reader, stranger]) {
      await expectTRPCError(
        callerFor(user).accounts.update({ id: account.id, ...input }),
        "FORBIDDEN",
      );
    }
  });

  it("lets a read+write member update", async () => {
    const owner = await createUser();
    const writer = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, writer, { canWrite: true });

    await expect(
      callerFor(writer).accounts.update({ id: account.id, ...input }),
    ).resolves.toBeTruthy();
  });

  it("refuses debt accounts", async () => {
    const user = await createUser();
    const debtId = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, user.id, CURRENCY.UAH),
    );

    await expectTRPCError(
      callerFor(user).accounts.update({ id: debtId, ...input }),
      "FORBIDDEN",
      "account_is_debt",
    );
  });

  it("locks the currency once the account has transactions", async () => {
    const user = await createUser();
    const account = await makeAccount(user, { currencyId: CURRENCY.UAH });
    const change = { id: account.id, ...input, currencyId: CURRENCY.USD };

    // no transactions yet: allowed
    await callerFor(user).accounts.update(change);
    await callerFor(user).accounts.update({
      ...change,
      currencyId: CURRENCY.UAH,
    });

    await insertTransactionRow({
      accountId: account.id,
      amount: -1,
      isPlanned: true,
      createdBy: user.id,
    });

    await expectTRPCError(
      callerFor(user).accounts.update(change),
      "BAD_REQUEST",
      "account_currency_locked",
    );

    // other fields can still change
    await expect(
      callerFor(user).accounts.update({ ...change, currencyId: CURRENCY.UAH }),
    ).resolves.toBeTruthy();
  });
});

describe("accounts.setActive", () => {
  it("toggles the flag with write access only", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, reader);

    await callerFor(owner).accounts.setActive({
      id: account.id,
      isActive: false,
    });
    expect(
      (
        await db.query.accounts.findFirst({
          where: eq(accounts.id, account.id),
        })
      )?.isActive,
    ).toBe(false);

    await expectTRPCError(
      callerFor(reader).accounts.setActive({ id: account.id, isActive: true }),
      "FORBIDDEN",
    );
  });
});

describe("accounts.delete", () => {
  it("soft-deletes an unused account and its member rows", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    await callerFor(user).accounts.delete({ id: account.id });

    const row = await db.query.accounts.findFirst({
      where: eq(accounts.id, account.id),
    });
    expect(row?.deletedAt).toBeInstanceOf(Date);

    const members = await db
      .select()
      .from(accountMembers)
      .where(eq(accountMembers.accountId, account.id));
    expect(members.every((member) => member.deletedAt !== null)).toBe(true);

    expect(await callerFor(user).accounts.list()).toEqual([]);
  });

  it("refuses an account with live transactions", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await insertTransactionRow({
      accountId: account.id,
      amount: -1,
      createdBy: user.id,
    });

    await expectTRPCError(
      callerFor(user).accounts.delete({ id: account.id }),
      "BAD_REQUEST",
      "account_has_transactions",
    );
  });

  it("refuses an account with a live schedule", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await db.insert(plannedTransactions).values({
      kind: "expense",
      startDate: "2026-01-01",
      repeatType: "monthly",
      amount: -100,
      accountId: account.id,
      createdBy: user.id,
    });

    await expectTRPCError(
      callerFor(user).accounts.delete({ id: account.id }),
      "BAD_REQUEST",
      "account_has_transactions",
    );
  });

  it("ignores deleted transactions", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await insertTransactionRow({
      accountId: account.id,
      amount: -1,
      deletedAt: new Date(),
      createdBy: user.id,
    });

    await expect(
      callerFor(user).accounts.delete({ id: account.id }),
    ).resolves.toBeUndefined();
  });

  it("needs write access and refuses debt accounts", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, reader);

    await expectTRPCError(
      callerFor(reader).accounts.delete({ id: account.id }),
      "FORBIDDEN",
    );

    const debtId = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, owner.id, CURRENCY.UAH),
    );
    await expectTRPCError(
      callerFor(owner).accounts.delete({ id: debtId }),
      "FORBIDDEN",
      "account_is_debt",
    );
  });
});

describe("getOrCreateDebtAccount", () => {
  it("creates one debt account per currency, named in the user's locale", async () => {
    const user = await createUser({ locale: "uk" });

    const uah = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, user.id, CURRENCY.UAH),
    );
    const again = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, user.id, CURRENCY.UAH),
    );
    const usd = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, user.id, CURRENCY.USD),
    );

    expect(again).toBe(uah);
    expect(usd).not.toBe(uah);

    const rows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.createdBy, user.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.type === "debt")).toBe(true);
    expect(rows.every((row) => row.name === "Борги")).toBe(true);
  });

  it("is per user", async () => {
    const a = await createUser({ locale: "en" });
    const b = await createUser();

    const first = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, a.id, CURRENCY.UAH),
    );
    const second = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, b.id, CURRENCY.UAH),
    );

    expect(first).not.toBe(second);
    const row = await db.query.accounts.findFirst({
      where: eq(accounts.id, first),
    });
    expect(row?.name).toBe("Debts");
  });

  it("creates exactly one under concurrency", async () => {
    const user = await createUser();

    const ids = await Promise.all(
      Array.from({ length: 5 }, () =>
        db.transaction((tx) =>
          getOrCreateDebtAccount(tx, user.id, CURRENCY.EUR),
        ),
      ),
    );

    expect(new Set(ids).size).toBe(1);
  });

  it("avoids a name clash with a regular account called Debts", async () => {
    const user = await createUser({ locale: "en" });
    await makeAccount(user, { name: "Debts", currencyId: CURRENCY.UAH });

    const id = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, user.id, CURRENCY.UAH),
    );
    const row = await db.query.accounts.findFirst({
      where: eq(accounts.id, id),
    });

    expect(row?.name).toBe("Debts (2)");
  });
});

describe("accounts.currencies", () => {
  it("lists the seeded currencies ordered by code", async () => {
    const user = await createUser();
    const rows = await callerFor(user).accounts.currencies();

    expect(rows.map((row) => row.code)).toEqual(["EUR", "GBP", "UAH", "USD"]);
    expect(rows.find((row) => row.code === "UAH")).toEqual({
      id: CURRENCY.UAH,
      code: "UAH",
      sign: "₴",
    });
  });
});
