import type { APIRequestContext } from "@playwright/test";
import { addDays, format, subDays } from "date-fns";

import type { TransactionInputData } from "~/lib/validators/transactions";
import { expect, test as setup } from "./helpers";

/**
 * Fills the signed-in administrator's books with a few months of believable
 * activity for the README screenshots (`pnpm screenshots`). Everything goes
 * through the app's own tRPC endpoints, so the data is exactly what the forms
 * would have written. Dates are relative to today, so the dashboard and the
 * report look lived-in whenever this runs. A few categories get subcategories,
 * so the nested labels and the report's roll-up have something to show.
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

  const addSubcategory = async (
    parentKey: string,
    name: string,
    kind: "expense" | "income" = "expense",
  ) =>
    (
      (await mutate("categories.create", {
        name,
        parentId: category(parentKey),
        isExpense: kind === "expense",
        isIncome: kind === "income",
      })) as { id: string }
    ).id;

  // the shapes the nested views must handle: a parent with only child rows
  // (home), one with direct rows as well (groceries), a single child
  // (recreation) and an income child
  const rent = await addSubcategory("home", "Rent");
  const utilities = await addSubcategory("home", "Utilities");
  const supermarket = await addSubcategory("groceries", "Supermarket");
  const market = await addSubcategory("groceries", "Farmers' market");
  const restaurants = await addSubcategory("entertainment", "Restaurants");
  const bonus = await addSubcategory("income", "Bonus", "income");

  const items: TransactionInputData[] = [];
  const expense = (
    offset: number,
    amount: number,
    categoryId: string,
    comment: string,
    accountId = card,
  ) =>
    items.push({
      kind: "expense",
      date: day(offset),
      amount: uah(amount),
      accountId,
      categoryId,
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
    expense(start - 27, 16_500, rent, "Rent");
    expense(start - 26, 1_840, utilities, "Utilities");
    expense(start - 25, 399, category("subscriptions"), "Music streaming");
    expense(start - 24, 2_150.4, category("groceries"), "Weekly shop");
    expense(start - 20, 1_720.9, supermarket, "Weekly shop");
    expense(start - 17, 980, category("commuting"), "Taxi to the airport");
    expense(start - 14, 2_430.15, market, "Weekly shop");
    expense(start - 12, 1_200, restaurants, "Cinema and dinner");
    expense(start - 10, 640, category("animals"), "Cat food", wallet);
    expense(start - 7, 1_915.6, supermarket, "Weekly shop");
    expense(start - 5, 850, category("health"), "Pharmacy");
    expense(start - 3, 3_400, category("clothing"), "Running shoes");
    expense(start - 2, 450, category("self_care"), "Haircut", wallet);
  }

  expense(-40, 14_999, category("devices"), "New headphones");
  expense(-8, 2_600, category("gifts"), "Birthday present");
  items.push(
    {
      kind: "income",
      date: day(-45),
      amount: uah(8_000),
      accountId: card,
      categoryId: bonus,
      comment: "Quarterly bonus",
    },
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
      categoryId: rent,
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
      categoryId: utilities,
      comment: "Utilities",
    },
    "none",
  );
});
