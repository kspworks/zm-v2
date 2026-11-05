import { and, asc, eq, isNull, lt, ne, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";

import type { Locale } from "~/i18n/config";
import { query } from "~/server/db/database";
import {
  accountMembers,
  accounts,
  currencies,
  transactions,
  users,
} from "~/server/db/schema";
import { Mailer } from "~/server/effect/mailer";
import { tomorrow } from "~/server/lib/clock";
import {
  insufficientFundsEmail,
  type ShortageSection,
} from "~/server/mail/templates";

export type Recipient = {
  userId: string;
  email: string;
  locale: Locale;
  sections: ShortageSection[];
};

/**
 * For `day` (tomorrow), the planned sum per account; every account whose
 * balance plus that sum would go below zero becomes a section for every
 * user who can read it (shared accounts notify every member).
 */
export const collectShortages = Effect.fn("jobs.collectShortages")(function* (
  day: string,
) {
  const rows = yield* query((db) => {
    const settled = alias(transactions, "settled");

    const planned = db.$with("planned").as(
      db
        .select({
          accountId: transactions.accountId,
          plannedSum: sum(transactions.amount).as("planned_sum"),
        })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(
          and(
            eq(transactions.isPlanned, true),
            isNull(transactions.deletedAt),
            eq(transactions.date, day),
            isNull(accounts.deletedAt),
            ne(accounts.type, "debt"),
          ),
        )
        .groupBy(transactions.accountId),
    );

    const balances = db.$with("balances").as(
      db
        .select({
          accountId: planned.accountId,
          plannedSum: planned.plannedSum,
          balance: sql<string>`${accounts.initialBalance} + coalesce((${db
            .select({ sum: sum(settled.amount) })
            .from(settled)
            .where(
              and(
                eq(settled.accountId, planned.accountId),
                isNull(settled.deletedAt),
                eq(settled.isPlanned, false),
              ),
            )}), 0)`.as("balance"),
        })
        .from(planned)
        .innerJoin(accounts, eq(accounts.id, planned.accountId)),
    );

    return db
      .with(planned, balances)
      .select({
        userId: users.id,
        email: users.email,
        locale: users.locale,
        accountName: accounts.name,
        currencySign: currencies.sign,
        plannedSum: balances.plannedSum,
        balance: balances.balance,
      })
      .from(balances)
      .innerJoin(accounts, eq(accounts.id, balances.accountId))
      .innerJoin(currencies, eq(currencies.id, accounts.currencyId))
      .innerJoin(
        accountMembers,
        and(
          eq(accountMembers.accountId, accounts.id),
          isNull(accountMembers.deletedAt),
          eq(accountMembers.canRead, true),
        ),
      )
      .innerJoin(
        users,
        and(
          eq(users.id, accountMembers.userId),
          isNull(users.deletedAt),
          eq(users.banned, false),
        ),
      )
      .where(lt(sql`${balances.balance} + ${balances.plannedSum}`, 0))
      .orderBy(asc(users.id), asc(accounts.name));
  });

  const byUser = new Map<string, Recipient>();

  for (const row of rows) {
    const plannedAmount = Number(row.plannedSum);
    const currentBalance = Number(row.balance);
    const recipient = byUser.get(row.userId) ?? {
      userId: row.userId,
      email: row.email,
      locale: row.locale === "en" ? "en" : "uk",
      sections: [],
    };

    recipient.sections.push({
      accountName: row.accountName,
      date: day,
      plannedAmount,
      currentBalance,
      shortage: plannedAmount + currentBalance,
      currencySign: row.currencySign,
    });
    byUser.set(row.userId, recipient);
  }

  return [...byUser.values()];
});

/** 09:00: one "insufficient funds" email per recipient; failures don't stop the rest */
export const dailyMorning = Effect.fn("jobs.dailyMorning")(function* () {
  const mailer = yield* Mailer;

  if (!mailer.configured) {
    yield* Effect.log("insufficient funds: SMTP is not configured, skipped");

    return;
  }

  const day = yield* tomorrow;
  const recipients = yield* collectShortages(day);
  yield* Effect.log(
    `insufficient funds: ${recipients.length} recipients for ${day}`,
  );

  for (const recipient of recipients) {
    const result = yield* Effect.tryPromise(() =>
      insufficientFundsEmail(recipient.locale, recipient.sections),
    ).pipe(
      Effect.flatMap((mail) => mailer.send({ to: recipient.email, ...mail })),
      Effect.orElseSucceed(() => "failed" as const),
    );

    yield* Effect.log(`insufficient funds: ${recipient.email} - ${result}`);
  }
});
