import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { TransactionInput } from "~/lib/validators/transactions";
import { db } from "~/server/db";
import { accounts, transactions } from "~/server/db/schema";
import { deleteAccount } from "~/server/services/accounts";
import { createTransaction } from "~/server/services/transactions";
import { expectTRPCError } from "../helpers/errors";
import { createUser, makeAccount } from "../helpers/fixtures";
import { signal, untilBlockedOnLock } from "../helpers/locks";

const expense = (accountId: string): TransactionInput => ({
  kind: "expense",
  date: "2026-03-10",
  amount: 1000,
  accountId,
  categoryId: null,
  counterparty: null,
  comment: null,
});

const liveTransactionsOn = (accountId: string) =>
  db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
      ),
    );

describe("account deletion racing a write into the account", () => {
  it("refuses a create whose delete commits while it waits", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    // the delete has run but not committed when the create starts
    const deleted = signal();
    const commit = signal();
    const deleting = db.transaction(async (tx) => {
      await deleteAccount(tx, user.id, account.id);
      deleted.resolve();
      await commit.promise;
    });
    await deleted.promise;

    const creating = expectTRPCError(
      createTransaction(db, user.id, expense(account.id)),
      "FORBIDDEN",
    );
    await untilBlockedOnLock();
    commit.resolve();
    await deleting;
    await creating;

    const [row] = await db
      .select({ deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(eq(accounts.id, account.id));
    expect(row?.deletedAt).not.toBeNull();
    expect(await liveTransactionsOn(account.id)).toEqual([]);
  });

  it("refuses a delete whose create commits while it waits", async () => {
    const user = await createUser();
    const account = await makeAccount(user);

    // the create has run but not committed when the delete starts
    const created = signal();
    const commit = signal();
    const creating = db.transaction(async (tx) => {
      await createTransaction(tx, user.id, expense(account.id));
      created.resolve();
      await commit.promise;
    });
    await created.promise;

    const deleting = expectTRPCError(
      deleteAccount(db, user.id, account.id),
      "BAD_REQUEST",
      "account_has_transactions",
    );
    await untilBlockedOnLock();
    commit.resolve();
    await creating;
    await deleting;

    const [row] = await db
      .select({ deletedAt: accounts.deletedAt })
      .from(accounts)
      .where(eq(accounts.id, account.id));
    expect(row?.deletedAt).toBeNull();
    expect(await liveTransactionsOn(account.id)).toHaveLength(1);
  });
});
