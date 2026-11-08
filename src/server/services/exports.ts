import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";

import { type ExportRow, transactionsCsv } from "~/lib/export-csv";
import { query } from "~/server/db/database";
import {
  accountMembers,
  accounts,
  categories,
  counterparties,
  currencies,
  transactions,
} from "~/server/db/schema";
import { today } from "~/server/lib/clock";
import { listAccounts } from "~/server/services/accounts";
import { listCategories } from "~/server/services/categories";

const category = alias(categories, "category");
const parent = alias(categories, "parent");

/** Every submitted leg on an account the user can read, newest first */
const exportRows = Effect.fnUntraced(function* (userId: string) {
  const rows: ExportRow[] = yield* query((db) =>
    db
      .select({
        date: transactions.date,
        kind: transactions.kind,
        amount: transactions.amount,
        currencyCode: currencies.code,
        accountName: accounts.name,
        accountType: accounts.type,
        categoryName: category.name,
        parentName: parent.name,
        counterpartyName: counterparties.name,
        comment: transactions.comment,
        batchId: transactions.batchId,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .innerJoin(
        accountMembers,
        and(
          eq(accountMembers.accountId, accounts.id),
          eq(accountMembers.userId, userId),
          eq(accountMembers.canRead, true),
          isNull(accountMembers.deletedAt),
        ),
      )
      .innerJoin(currencies, eq(currencies.id, accounts.currencyId))
      .leftJoin(category, eq(category.id, transactions.categoryId))
      .leftJoin(parent, eq(parent.id, category.parentId))
      .leftJoin(
        counterparties,
        eq(counterparties.id, transactions.counterpartyId),
      )
      .where(
        and(
          isNull(transactions.deletedAt),
          eq(transactions.isPlanned, false),
          isNull(accounts.deletedAt),
        ),
      )
      .orderBy(
        desc(transactions.date),
        desc(transactions.createdAt),
        desc(transactions.id),
      ),
  );

  return rows;
});

export const exportCsv = Effect.fn("exports.csv")(function* (userId: string) {
  const date = yield* today;
  const rows = yield* exportRows(userId);

  return {
    filename: `zm-transactions-${date}.csv`,
    content: transactionsCsv(rows),
  };
});

/** A readable copy of the books. It is not a format the app imports */
export const exportJson = Effect.fn("exports.json")(function* (
  userId: string,
  locale: Parameters<typeof listCategories>[1],
) {
  const date = yield* today;
  const [accountRows, categoryRows, rows] = yield* Effect.all(
    [listAccounts(userId), listCategories(userId, locale), exportRows(userId)],
    { concurrency: "unbounded" },
  );

  return {
    filename: `zm-backup-${date}.json`,
    content: JSON.stringify(
      {
        exportedOn: date,
        accounts: accountRows.map((account) => ({
          name: account.name,
          type: account.type,
          currency: account.currencyCode,
          initialBalance: account.initialBalance,
          balance: account.balance,
          isActive: account.isActive,
        })),
        categories: categoryRows.map((row) => ({
          name: row.name,
          parent: row.parentName,
          isExpense: row.isExpense,
          isIncome: row.isIncome,
        })),
        transactions: rows,
      },
      null,
      2,
    ),
  };
});
