import { describe, expect, it } from "vitest";

import { callerFor } from "../helpers/caller";
import { createUser, makeAccount, makeCategory } from "../helpers/fixtures";

describe("history.list", () => {
  it("shows the user's own changes, a transfer as one", async () => {
    const user = await createUser();
    const other = await createUser();
    const from = await makeAccount(user);
    const to = await makeAccount(user);
    const created = await callerFor(user).transactions.create({
      kind: "transfer",
      date: "2026-03-10",
      amount: 500,
      accountId: from.id,
      linkedAccountId: to.id,
      linkedAmount: 500,
      comment: "To savings",
    });
    await callerFor(user).transactions.delete({ id: created.ids[0] ?? "" });

    const items = (await callerFor(user).history.list({})).items.filter(
      (item) => item.entityType === "transaction",
    );

    expect(
      items.map((item) => [item.action, item.entityType, item.count]),
    ).toEqual([
      ["delete", "transaction", 1],
      ["create", "transaction", 1],
    ]);
    expect(items[0]?.label).toBe("To savings");
    const theirs = await callerFor(other).history.list({});

    expect(theirs.items.some((item) => item.label === "To savings")).toBe(
      false,
    );
  });
});

describe("exports", () => {
  it("writes a CSV of the user's legs that a spreadsheet can't run", async () => {
    const user = await createUser();
    const account = await makeAccount(user, { name: "Card" });
    const food = await makeCategory(user, { name: "Food" });

    await callerFor(user).transactions.create({
      kind: "expense",
      date: "2026-03-10",
      amount: 12345,
      accountId: account.id,
      categoryId: food.id,
      comment: "=HYPERLINK(1)",
    });

    const file = await callerFor(user).exports.csv();
    const [header, row] = file.content.split("\r\n");

    expect(file.filename).toMatch(/^zm-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(header).toBe(
      "date,kind,amount,currency,account,account_type,category,subcategory,counterparty,comment,batch_id",
    );
    expect(row).toBe(
      "2026-03-10,expense,-123.45,UAH,Card,card,Food,,,'=HYPERLINK(1),",
    );
  });

  it("writes a JSON copy with accounts and categories", async () => {
    const user = await createUser();
    await makeAccount(user, { name: "Card", initialBalance: 100 });

    const file = await callerFor(user).exports.json();
    const data = JSON.parse(file.content);

    expect(data.accounts).toContainEqual(
      expect.objectContaining({ name: "Card", initialBalance: 100 }),
    );
    expect(Array.isArray(data.transactions)).toBe(true);
  });
});
