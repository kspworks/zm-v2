import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import {
  counterparties,
  plannedTransactions,
  transactions,
} from "~/server/db/schema";
import { getOrCreateDebtAccount } from "~/server/services/accounts";
import { resolveCounterparty } from "~/server/services/counterparties";
import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import {
  CURRENCY,
  createUser,
  grant,
  insertTransactionRow,
  makeAccount,
} from "../helpers/fixtures";

const resolve = (userId: string, name: string) =>
  db.transaction((tx) => resolveCounterparty(tx, userId, name));

describe("resolveCounterparty", () => {
  it("creates a new counterparty, trimmed", async () => {
    const user = await createUser();
    const id = await resolve(user.id, "  Alex   K ");

    const row = await db.query.counterparties.findFirst({
      where: eq(counterparties.id, id),
    });
    expect(row).toMatchObject({ name: "Alex K", ownerId: user.id });
  });

  it("matches an existing one case-insensitively", async () => {
    const user = await createUser();
    const first = await resolve(user.id, "Alex");

    expect(await resolve(user.id, "alex")).toBe(first);
    expect(await resolve(user.id, " ALEX ")).toBe(first);
  });

  it("keeps counterparties per owner", async () => {
    const a = await createUser();
    const b = await createUser();

    expect(await resolve(a.id, "Alex")).not.toBe(await resolve(b.id, "Alex"));
  });

  it("creates exactly one under concurrency", async () => {
    const user = await createUser();

    const ids = await Promise.all(
      ["Alex", "alex", "ALEX", " Alex", "Alex "].map((name) =>
        resolve(user.id, name),
      ),
    );

    expect(new Set(ids).size).toBe(1);
  });

  it("creates a fresh one when the match was deleted", async () => {
    const user = await createUser();
    const first = await resolve(user.id, "Alex");
    await db
      .update(counterparties)
      .set({ deletedAt: new Date() })
      .where(eq(counterparties.id, first));

    expect(await resolve(user.id, "Alex")).not.toBe(first);
  });
});

describe("counterparties.rename", () => {
  it("renames, refusing a name already taken", async () => {
    const user = await createUser();
    const alex = await resolve(user.id, "Alex");
    await resolve(user.id, "Olena");

    await callerFor(user).counterparties.rename({
      id: alex,
      name: "Alexander",
    });
    const row = await db.query.counterparties.findFirst({
      where: eq(counterparties.id, alex),
    });
    expect(row?.name).toBe("Alexander");

    await expectTRPCError(
      callerFor(user).counterparties.rename({ id: alex, name: "olena" }),
      "BAD_REQUEST",
      "counterparty_name_not_unique",
    );
  });

  it("only touches the user's own counterparties", async () => {
    const owner = await createUser();
    const id = await resolve(owner.id, "Alex");

    await expectTRPCError(
      callerFor(await createUser()).counterparties.rename({ id, name: "X" }),
      "NOT_FOUND",
    );
  });
});

describe("counterparties.merge", () => {
  it("repoints transactions and schedules, then deletes the source", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const source = await resolve(user.id, "Alex");
    const target = await resolve(user.id, "Alexander");

    const tx = await insertTransactionRow({
      accountId: account.id,
      amount: -100,
      counterpartyId: source,
      createdBy: user.id,
    });
    const [schedule] = await db
      .insert(plannedTransactions)
      .values({
        kind: "expense",
        startDate: "2026-01-01",
        repeatType: "monthly",
        amount: -100,
        accountId: account.id,
        counterpartyId: source,
        createdBy: user.id,
      })
      .returning();

    const result = await callerFor(user).counterparties.merge({
      sourceId: source,
      targetId: target,
    });

    expect(result.moved).toBe(1);

    const movedTx = await db.query.transactions.findFirst({
      where: eq(transactions.id, tx.id),
    });
    expect(movedTx?.counterpartyId).toBe(target);

    const movedSchedule = await db.query.plannedTransactions.findFirst({
      where: eq(plannedTransactions.id, schedule?.id ?? ""),
    });
    expect(movedSchedule?.counterpartyId).toBe(target);

    const sourceRow = await db.query.counterparties.findFirst({
      where: eq(counterparties.id, source),
    });
    expect(sourceRow?.deletedAt).toBeInstanceOf(Date);
  });

  it("refuses merging into itself or someone else's counterparty", async () => {
    const user = await createUser();
    const mine = await resolve(user.id, "Alex");
    const theirs = await resolve((await createUser()).id, "Alex");

    await expectTRPCError(
      callerFor(user).counterparties.merge({ sourceId: mine, targetId: mine }),
      "BAD_REQUEST",
      "counterparty_merge_self",
    );
    await expectTRPCError(
      callerFor(user).counterparties.merge({
        sourceId: mine,
        targetId: theirs,
      }),
      "NOT_FOUND",
    );
  });
});

describe("counterparties.delete", () => {
  it("deletes an unused counterparty", async () => {
    const user = await createUser();
    const id = await resolve(user.id, "Alex");

    await callerFor(user).counterparties.delete({ id });

    expect(await callerFor(user).counterparties.list()).toEqual([]);
  });

  it("refuses a counterparty used by a live transaction", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const id = await resolve(user.id, "Alex");
    await insertTransactionRow({
      accountId: account.id,
      amount: -1,
      counterpartyId: id,
      createdBy: user.id,
    });

    await expectTRPCError(
      callerFor(user).counterparties.delete({ id }),
      "BAD_REQUEST",
      "counterparty_in_use",
    );
  });
});

describe("counterparties.balances", () => {
  it("sums debt-account legs per counterparty and currency", async () => {
    const user = await createUser();
    const uahDebt = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, user.id, CURRENCY.UAH),
    );
    const usdDebt = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, user.id, CURRENCY.USD),
    );
    const cash = await makeAccount(user);
    const alex = await resolve(user.id, "Alex");
    const olena = await resolve(user.id, "Olena");

    const leg = (accountId: string, amount: number, counterpartyId: string) =>
      insertTransactionRow({
        kind: "debt",
        accountId,
        amount,
        counterpartyId,
        createdBy: user.id,
      });

    // I lent Alex 500 UAH, he repaid 200: he owes me 300 UAH
    await leg(uahDebt, 500, alex);
    await leg(uahDebt, -200, alex);
    // I borrowed 100 USD from Alex
    await leg(usdDebt, -100, alex);
    // I borrowed 1000 UAH from Olena
    await leg(uahDebt, -1000, olena);
    // real-account legs and planned rows don't count
    await leg(cash.id, -500, alex);
    await insertTransactionRow({
      kind: "debt",
      accountId: uahDebt,
      amount: 9999,
      counterpartyId: alex,
      isPlanned: true,
      createdBy: user.id,
    });

    const rows = await callerFor(user).counterparties.balances();

    expect(
      rows.map((r) => [r.counterpartyName, r.currencyCode, r.sum]),
    ).toEqual([
      ["Alex", "UAH", 300],
      ["Alex", "USD", -100],
      ["Olena", "UAH", -1000],
    ]);

    const list = await callerFor(user).counterparties.list();
    expect(list.find((row) => row.id === alex)?.balances).toMatchObject([
      { currencyCode: "UAH", sum: 300 },
      { currencyCode: "USD", sum: -100 },
    ]);
  });

  it("hides settled balances", async () => {
    const user = await createUser();
    const debt = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, user.id, CURRENCY.UAH),
    );
    const alex = await resolve(user.id, "Alex");

    for (const amount of [500, -500]) {
      await insertTransactionRow({
        kind: "debt",
        accountId: debt,
        amount,
        counterpartyId: alex,
        createdBy: user.id,
      });
    }

    expect(await callerFor(user).counterparties.balances()).toEqual([]);
  });

  it("covers debt accounts shared with the user", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const debt = await db.transaction((tx) =>
      getOrCreateDebtAccount(tx, owner.id, CURRENCY.UAH),
    );
    await grant("account", debt, reader);
    await insertTransactionRow({
      kind: "debt",
      accountId: debt,
      amount: 700,
      counterpartyId: await resolve(owner.id, "Alex"),
      createdBy: owner.id,
    });

    const rows = await callerFor(reader).counterparties.balances();
    expect(rows).toMatchObject([{ counterpartyName: "Alex", sum: 700 }]);
  });
});
