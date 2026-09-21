import type { APIRequestContext } from "@playwright/test";
import { addDays, format, subDays } from "date-fns";

import type { TransactionInputData } from "~/lib/validators/transactions";
import { expect, test as setup } from "./helpers";

/**
 * Fills the signed-in administrator's books with a few months of believable
 * activity for the README screenshots (`pnpm screenshots`). Everything goes
 * through the app's own tRPC endpoints, so the data is exactly what the forms
 * would have written. Dates are relative to today, so the dashboard and the
 * report look lived-in whenever this runs.
 */

type Procedure = (path: string, input?: unknown) => Promise<unknown>;

const trpc = (request: APIRequestContext) => {
  const call =
    (method: "GET" | "POST"): Procedure =>
    async (path, input) => {
      const url = `/api/trpc/${path}`;
      const response =
        method === "GET"
          ? await request.get(
              input === undefined
                ? url
                : `${url}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
            )
          : await request.post(url, { data: { json: input } });
      const body = await response.json();

      expect(response.ok(), `${path}: ${JSON.stringify(body)}`).toBe(true);

      return body.result.data.json;
    };

  return { query: call("GET"), mutate: call("POST") };
};

const day = (offset: number) =>
  format(
    offset < 0 ? subDays(new Date(), -offset) : addDays(new Date(), offset),
    "yyyy-MM-dd",
  );

/** Hryvnias to minor units */
const uah = (value: number) => Math.round(value * 100);

setup("seed the demo books", async ({ request }) => {
  const { query, mutate } = trpc(request);

  const currencies = (await query("accounts.currencies")) as {
    id: string;
    code: string;
  }[];
  const currency = (code: string) => {
    const found = currencies.find((row) => row.code === code);
    expect(found, code).toBeDefined();
    return found?.id ?? "";
  };

  const addAccount = async (
    name: string,
    type: string,
    code: string,
    initialBalance: number,
  ) =>
    (
      (await mutate("accounts.create", {
        name,
        type,
        currencyId: currency(code),
        initialBalance,
      })) as { id: string }
    ).id;

  const card = await addAccount("Mono card", "card", "UAH", uah(18_400));
  const savings = await addAccount("Savings", "deposit", "UAH", uah(120_000));
  const dollars = await addAccount("Dollar stash", "cash", "USD", 1_250_00);
  const wallet = await addAccount("Wallet", "cash", "UAH", uah(5_300));

  // registration opens an empty "Cash" per currency; hide them from the
  // sidebar and the currency switcher
  const existing = (await query("accounts.list")) as {
    id: string;
    name: string;
  }[];
  for (const account of existing.filter((row) => row.name === "Cash")) {
    await mutate("accounts.setActive", { id: account.id, isActive: false });
  }

  const categories = (await query("categories.list")) as {
    id: string;
    seedKey: string | null;
  }[];
  const category = (seedKey: string) => {
    const found = categories.find((row) => row.seedKey === seedKey);
    expect(found, seedKey).toBeDefined();
    return found?.id ?? "";
  };

  const items: TransactionInputData[] = [];
  const expense = (
    offset: number,
    amount: number,
    seedKey: string,
    comment: string,
    accountId = card,
  ) =>
    items.push({
      kind: "expense",
      date: day(offset),
      amount: uah(amount),
      accountId,
      categoryId: category(seedKey),
      comment,
    });

  // three months back: salary on the 1st-ish, the usual spending in between
  for (const month of [0, 1, 2]) {
    const start = -month * 30;

    items.push({
      kind: "income",
      date: day(start - 28),
      amount: uah(62_000),
      accountId: card,
      categoryId: category("salary"),
      comment: "Salary",
    });
    expense(start - 27, 16_500, "home", "Rent");
    expense(start - 26, 1_840, "home", "Utilities");
    expense(start - 25, 399, "subscriptions", "Music streaming");
    expense(start - 24, 2_150.4, "groceries", "Weekly shop");
    expense(start - 20, 1_720.9, "groceries", "Weekly shop");
    expense(start - 17, 980, "commuting", "Taxi to the airport");
    expense(start - 14, 2_430.15, "groceries", "Weekly shop");
    expense(start - 12, 1_200, "entertainment", "Cinema and dinner");
    expense(start - 10, 640, "animals", "Cat food", wallet);
    expense(start - 7, 1_915.6, "groceries", "Weekly shop");
    expense(start - 5, 850, "health", "Pharmacy");
    expense(start - 3, 3_400, "clothing", "Running shoes");
    expense(start - 2, 450, "self_care", "Haircut", wallet);
  }

  expense(-40, 14_999, "devices", "New headphones");
  expense(-8, 2_600, "gifts", "Birthday present");
  items.push(
    {
      kind: "transfer",
      date: day(-26),
      amount: uah(10_000),
      accountId: card,
      linkedAccountId: savings,
      linkedAmount: uah(10_000),
      comment: "Monthly saving",
    },
    {
      kind: "debt",
      date: day(-15),
      amount: uah(3_000),
      accountId: card,
      direction: "gave",
      counterparty: { name: "Olena" },
      comment: "Concert tickets",
    },
    {
      kind: "debt",
      date: day(-4),
      amount: uah(1_500),
      accountId: card,
      direction: "took",
      counterparty: { name: "Olena" },
      comment: "Half paid back",
    },
    {
      kind: "expense",
      date: day(-6),
      amount: 45_00,
      accountId: dollars,
      categoryId: category("entertainment"),
      comment: "Museum tickets",
    },
  );

  for (let start = 0; start < items.length; start += 100) {
    await mutate("transactions.bulkCreate", {
      items: items.slice(start, start + 100),
    });
  }

  const plan = (
    data: TransactionInputData,
    repeatType: "none" | "daily" | "weekly" | "monthly" | "yearly",
  ) =>
    mutate("planned.create", {
      data,
      schedule: { repeatType, repeatInterval: 1 },
    });

  await plan(
    {
      kind: "expense",
      date: day(3),
      amount: uah(16_500),
      accountId: card,
      categoryId: category("home"),
      comment: "Rent",
    },
    "monthly",
  );
  await plan(
    {
      kind: "expense",
      date: day(5),
      amount: uah(399),
      accountId: card,
      categoryId: category("subscriptions"),
      comment: "Music streaming",
    },
    "monthly",
  );
  await plan(
    {
      kind: "income",
      date: day(2),
      amount: uah(62_000),
      accountId: card,
      categoryId: category("salary"),
      comment: "Salary",
    },
    "monthly",
  );
  await plan(
    {
      kind: "expense",
      date: day(-1),
      amount: uah(1_840),
      accountId: card,
      categoryId: category("home"),
      comment: "Utilities",
    },
    "none",
  );
});
