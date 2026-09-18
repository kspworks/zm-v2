import { sql } from "drizzle-orm";

import type { Locale } from "~/i18n/config";
import { type MailConfig, mailConfig } from "~/server/config";
import type { CronLog } from "~/server/cron";
import type { DbOrTx } from "~/server/db";
import { tomorrow as tomorrowInAppZone } from "~/server/lib/clock";
import {
  insufficientFundsEmail,
  type ShortageSection,
} from "~/server/mail/templates";
import { type SendResult, sendMail } from "~/server/mail/transport";

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
export const collectShortages = async (
  db: DbOrTx,
  day: string,
): Promise<Recipient[]> => {
  const rows = await db.execute<{
    user_id: string;
    email: string;
    locale: string;
    account_name: string;
    currency_sign: string;
    planned_sum: string;
    balance: string;
  }>(sql`
    WITH planned AS (
      SELECT t.account_id, sum(t.amount) AS planned_sum
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.is_planned AND t.deleted_at IS NULL AND t.date = ${day}::date
        AND a.deleted_at IS NULL AND a.type <> 'debt'
      GROUP BY t.account_id
    ), balances AS (
      SELECT p.account_id, p.planned_sum,
        a.initial_balance + coalesce((
          SELECT sum(t.amount) FROM transactions t
          WHERE t.account_id = p.account_id
            AND t.deleted_at IS NULL AND NOT t.is_planned
        ), 0) AS balance
      FROM planned p JOIN accounts a ON a.id = p.account_id
    )
    SELECT u.id AS user_id, u.email, u.locale, a.name AS account_name,
      c.sign AS currency_sign, b.planned_sum, b.balance
    FROM balances b
    JOIN accounts a ON a.id = b.account_id
    JOIN currencies c ON c.id = a.currency_id
    JOIN account_members m ON m.account_id = a.id
      AND m.deleted_at IS NULL AND m.can_read
    JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL AND NOT u.banned
    WHERE b.balance + b.planned_sum < 0
    ORDER BY u.id, a.name
  `);

  const byUser = new Map<string, Recipient>();

  for (const row of rows) {
    const plannedAmount = Number(row.planned_sum);
    const currentBalance = Number(row.balance);
    const recipient = byUser.get(row.user_id) ?? {
      userId: row.user_id,
      email: row.email,
      locale: row.locale === "en" ? "en" : "uk",
      sections: [],
    };

    recipient.sections.push({
      accountName: row.account_name,
      date: day,
      plannedAmount,
      currentBalance,
      shortage: plannedAmount + currentBalance,
      currencySign: row.currency_sign,
    });
    byUser.set(row.user_id, recipient);
  }

  return [...byUser.values()];
};

/** 09:00: one "insufficient funds" email per recipient; failures don't stop the rest */
export const dailyMorning = async (
  db: DbOrTx,
  log: CronLog,
  {
    send = sendMail,
    config = mailConfig(),
  }: { send?: typeof sendMail; config?: MailConfig | null } = {},
) => {
  if (!config) {
    log("insufficient funds: SMTP is not configured, skipped");

    return;
  }

  const day = tomorrowInAppZone();
  const recipients = await collectShortages(db, day);
  log(`insufficient funds: ${recipients.length} recipients for ${day}`);

  for (const recipient of recipients) {
    let result: SendResult;

    try {
      const mail = await insufficientFundsEmail(
        recipient.locale,
        recipient.sections,
      );
      result = await send({ to: recipient.email, ...mail });
    } catch {
      result = "failed";
    }

    log(`insufficient funds: ${recipient.email} - ${result}`);
  }
};
