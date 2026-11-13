import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TransactionInputData } from "~/lib/validators/transactions";
import { db } from "~/server/db";
import {
  categories,
  idempotencyKeys,
  imports,
  plannedTransactions,
  transactions,
} from "~/server/db/schema";
import { sweepIdempotencyKeys } from "~/server/lib/idempotency";
import { callerFor } from "../helpers/caller";
import { buildCsv, expenseRow } from "../helpers/csv";
import { expectTRPCError } from "../helpers/errors";
import { createUser, makeAccount, makeCategory } from "../helpers/fixtures";
import { run } from "../helpers/run";

const KEY = "k1";

const expense = (
  accountId: string,
  extra: Partial<Extract<TransactionInputData, { kind: "expense" }>> = {},
): Extract<TransactionInputData, { kind: "expense" }> => ({
  kind: "expense",
  date: "2026-03-10",
  amount: 1000,
  accountId,
  comment: null,
  ...extra,
});

const rowsOn = (accountId: string) =>
  db.select().from(transactions).where(eq(transactions.accountId, accountId));

afterEach(() => {
  vi.useRealTimers();
});

describe("transactions.create with an idempotency key", () => {
  it("writes once and replays the first result on a retry", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const caller = callerFor(user);

    const first = await caller.transactions.create({
      ...expense(account.id),
      idempotencyKey: KEY,
    });
    const second = await caller.transactions.create({
      ...expense(account.id),
      idempotencyKey: KEY,
    });

    expect(second).toEqual(first);
    expect(await rowsOn(account.id)).toHaveLength(1);
  });

  it("writes every call when no key is sent", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const caller = callerFor(user);

    await caller.transactions.create(expense(account.id));
    await caller.transactions.create(expense(account.id));

    expect(await rowsOn(account.id)).toHaveLength(2);
    expect(await db.select().from(idempotencyKeys)).toHaveLength(0);
  });

  it("refuses the same key with a different request", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const caller = callerFor(user);

    await caller.transactions.create({
      ...expense(account.id),
      idempotencyKey: KEY,
    });

    await expectTRPCError(
      caller.transactions.create({
        ...expense(account.id, { amount: 2000 }),
        idempotencyKey: KEY,
      }),
      "BAD_REQUEST",
      "idempotency_key_reused",
    );
    expect(await rowsOn(account.id)).toHaveLength(1);
  });

  it("refuses the same key on another procedure", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const caller = callerFor(user);

    await caller.transactions.create({
      ...expense(account.id),
      idempotencyKey: KEY,
    });

    await expectTRPCError(
      caller.categories.create({ name: "Food", idempotencyKey: KEY }),
      "BAD_REQUEST",
      "idempotency_key_reused",
    );
  });

  it("keeps one user's key apart from another's", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const aliceAccount = await makeAccount(alice);
    const bobAccount = await makeAccount(bob);

    await callerFor(alice).transactions.create({
      ...expense(aliceAccount.id),
      idempotencyKey: KEY,
    });
    await callerFor(bob).transactions.create({
      ...expense(bobAccount.id),
      idempotencyKey: KEY,
    });

    expect(await rowsOn(aliceAccount.id)).toHaveLength(1);
    expect(await rowsOn(bobAccount.id)).toHaveLength(1);
  });

  it("writes once when two identical calls race", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const caller = callerFor(user);
    const input = { ...expense(account.id), idempotencyKey: KEY };

    const [a, b] = await Promise.all([
      caller.transactions.create(input),
      caller.transactions.create(input),
    ]);

    expect(a).toEqual(b);
    expect(await rowsOn(account.id)).toHaveLength(1);
  });

  it("rolls the key back with a failed call, so a fixed retry writes", async () => {
    const user = await createUser();
    const stranger = await createUser();
    const account = await makeAccount(user);
    const foreign = await makeCategory(stranger);
    const caller = callerFor(user);

    await expectTRPCError(
      caller.transactions.create({
        ...expense(account.id, { categoryId: foreign.id }),
        idempotencyKey: KEY,
      }),
      "FORBIDDEN",
    );
    expect(await db.select().from(idempotencyKeys)).toHaveLength(0);

    await caller.transactions.create({
      ...expense(account.id),
      idempotencyKey: KEY,
    });

    expect(await rowsOn(account.id)).toHaveLength(1);
  });
});

describe("other keyed create calls", () => {
  it("bulkCreate writes its items once", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const caller = callerFor(user);
    const input = {
      items: [expense(account.id), expense(account.id, { amount: 500 })],
      idempotencyKey: KEY,
    };

    const first = await caller.transactions.bulkCreate(input);
    const second = await caller.transactions.bulkCreate(input);

    expect(second).toEqual(first);
    expect(await rowsOn(account.id)).toHaveLength(2);
  });

  it("planned.create writes one schedule", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const caller = callerFor(user);
    const input = {
      data: expense(account.id, { date: "2026-03-20" }),
      schedule: {
        repeatType: "daily" as const,
        repeatInterval: 1,
        endDate: "2026-03-22",
      },
      idempotencyKey: KEY,
    };

    await caller.planned.create(input);
    await caller.planned.create(input);

    const schedules = await db
      .select()
      .from(plannedTransactions)
      .where(eq(plannedTransactions.accountId, account.id));
    expect(schedules).toHaveLength(1);
  });

  it("categories.create writes one category", async () => {
    const user = await createUser();
    const caller = callerFor(user);

    const first = await caller.categories.create({
      name: "Garden",
      idempotencyKey: KEY,
    });
    const second = await caller.categories.create({
      name: "Garden",
      idempotencyKey: KEY,
    });

    expect(second.id).toBe(first.id);
    expect(
      await db.select().from(categories).where(eq(categories.name, "Garden")),
    ).toHaveLength(1);
  });

  it("imports.upload imports the file once", async () => {
    const user = await createUser();
    const caller = callerFor(user);
    const input = {
      fileName: "zen.csv",
      content: buildCsv([expenseRow()]),
      idempotencyKey: KEY,
    };

    const first = await caller.imports.upload(input);
    const second = await caller.imports.upload(input);

    expect(second).toEqual(first);
    expect(
      await db.select().from(imports).where(eq(imports.userId, user.id)),
    ).toHaveLength(1);
  });
});

describe("sweepIdempotencyKeys", () => {
  it("deletes keys older than a day and keeps fresh ones", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));

    const user = await createUser();
    const account = await makeAccount(user);
    const caller = callerFor(user);
    await caller.transactions.create({
      ...expense(account.id),
      idempotencyKey: "old",
    });

    vi.setSystemTime(new Date("2026-03-16T11:00:00Z"));
    await caller.transactions.create({
      ...expense(account.id),
      idempotencyKey: "fresh",
    });

    vi.setSystemTime(new Date("2026-03-16T13:00:00Z"));
    expect(await run(sweepIdempotencyKeys())).toBe(1);
    expect(
      (await db.select().from(idempotencyKeys)).map((row) => row.key),
    ).toEqual(["fresh"]);
  });
});
