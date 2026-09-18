import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { collectShortages, dailyMorning } from "~/server/jobs/daily-0900";
import {
  createUser,
  grant,
  insertTransactionRow,
  makeAccount,
} from "../helpers/fixtures";

// tomorrow in Europe/Kyiv is 2026-03-16
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const TOMORROW = "2026-03-16";

describe("collectShortages", () => {
  it("flags accounts whose balance plus tomorrow's planned sum goes negative", async () => {
    const user = await createUser({ email: "me@example.com", locale: "uk" });
    const short = await makeAccount(user, {
      name: "Card",
      initialBalance: 1000,
    });
    const fine = await makeAccount(user, {
      name: "Savings",
      initialBalance: 1000,
    });

    for (const [accountId, amount, date] of [
      [short.id, -800, TOMORROW],
      [short.id, -700, TOMORROW],
      [short.id, -9_999, "2026-03-17"],
      [fine.id, -500, TOMORROW],
    ] as const) {
      await insertTransactionRow({
        accountId,
        amount,
        date,
        isPlanned: true,
        createdBy: user.id,
      });
    }
    // deleted planned rows don't count
    await insertTransactionRow({
      accountId: fine.id,
      amount: -5000,
      date: TOMORROW,
      isPlanned: true,
      deletedAt: new Date(),
      createdBy: user.id,
    });

    expect(await collectShortages(db, TOMORROW)).toEqual([
      {
        userId: user.id,
        email: "me@example.com",
        locale: "uk",
        sections: [
          {
            accountName: "Card",
            date: TOMORROW,
            plannedAmount: -1500,
            currentBalance: 1000,
            shortage: -500,
            currencySign: "₴",
          },
        ],
      },
    ]);
  });

  it("notifies every member who can read a shared account", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const stranger = await createUser();
    const account = await makeAccount(owner);
    await grant("account", account.id, reader);
    await insertTransactionRow({
      accountId: account.id,
      amount: -100,
      date: TOMORROW,
      isPlanned: true,
      createdBy: owner.id,
    });

    const recipients = await collectShortages(db, TOMORROW);

    expect(recipients.map((r) => r.userId).sort()).toEqual(
      [owner.id, reader.id].sort(),
    );
    expect(recipients.some((r) => r.userId === stranger.id)).toBe(false);
  });

  it("combines several accounts into one mail per recipient", async () => {
    const user = await createUser();
    for (const name of ["A", "B"]) {
      const account = await makeAccount(user, { name });
      await insertTransactionRow({
        accountId: account.id,
        amount: -1,
        date: TOMORROW,
        isPlanned: true,
        createdBy: user.id,
      });
    }

    const [recipient] = await collectShortages(db, TOMORROW);
    expect(recipient?.sections.map((s) => s.accountName)).toEqual(["A", "B"]);
  });
});

describe("dailyMorning", () => {
  const config = {
    host: "smtp",
    port: 465,
    user: "u",
    pass: "p",
    from: "zm@x",
  };

  const setup = async () => {
    const users = await Promise.all([
      createUser({ email: "a@example.com" }),
      createUser({ email: "b@example.com" }),
    ]);

    for (const user of users) {
      const account = await makeAccount(user);
      await insertTransactionRow({
        accountId: account.id,
        amount: -1,
        date: TOMORROW,
        isPlanned: true,
        createdBy: user.id,
      });
    }
  };

  it("sends one mail per recipient and logs each outcome; a failure doesn't stop the rest", async () => {
    await setup();
    const sent: string[] = [];
    const lines: string[] = [];

    await dailyMorning(db, (line) => lines.push(line), {
      config,
      send: async (mail) => {
        sent.push(mail.to);

        return mail.to === "a@example.com" ? "failed" : "sent";
      },
    });

    expect(sent.sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(lines).toContain("insufficient funds: a@example.com - failed");
    expect(lines).toContain("insufficient funds: b@example.com - sent");
  });

  it("skips everything without SMTP settings", async () => {
    await setup();
    const lines: string[] = [];
    let calls = 0;

    await dailyMorning(db, (line) => lines.push(line), {
      config: null,
      send: async () => {
        calls += 1;

        return "sent";
      },
    });

    expect(calls).toBe(0);
    expect(lines).toEqual([
      "insufficient funds: SMTP is not configured, skipped",
    ]);
  });
});
