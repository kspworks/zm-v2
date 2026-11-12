import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import {
  budgets,
  categories,
  categoryMembers,
  historyLogs,
  plannedTransactions,
  transactions,
} from "~/server/db/schema";
import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import {
  CURRENCY,
  createUser,
  grant,
  insertTransactionRow,
  makeAccount,
  makeCategory,
} from "../helpers/fixtures";

const base = { name: "Food", isExpense: true, isIncome: false };

describe("categories.create", () => {
  it("creates a top-level category with a member row and audit", async () => {
    const user = await createUser();
    const category = await callerFor(user).categories.create({
      ...base,
      name: "  Food ",
    });

    expect(category).toMatchObject({
      name: "Food",
      parentId: null,
      isExpense: true,
      isIncome: false,
    });

    const [member] = await db
      .select()
      .from(categoryMembers)
      .where(eq(categoryMembers.categoryId, category.id));
    expect(member).toMatchObject({ canRead: true, canWrite: true });

    const logs = await db
      .select()
      .from(historyLogs)
      .where(eq(historyLogs.entityId, category.id));
    expect(logs).toMatchObject([{ entityType: "category", action: "create" }]);
  });

  it("defaults to expense only", async () => {
    const user = await createUser();
    const category = await callerFor(user).categories.create({ name: "X" });

    expect(category).toMatchObject({ isExpense: true, isIncome: false });
  });

  it("requires at least one of the flags", async () => {
    const user = await createUser();
    const error = await expectTRPCError(
      callerFor(user).categories.create({
        name: "Nothing",
        isExpense: false,
        isIncome: false,
      }),
      "BAD_REQUEST",
    );

    expect(JSON.stringify(error.cause)).toContain("category_kind_required");
  });

  it("accepts a readable top-level parent", async () => {
    const user = await createUser();
    const parent = await makeCategory(user, { name: "Home" });
    const child = await callerFor(user).categories.create({
      ...base,
      parentId: parent.id,
    });

    expect(child.parentId).toBe(parent.id);
  });

  it("gives one answer for every disallowed parent", async () => {
    const user = await createUser();
    const other = await createUser();
    const foreign = await makeCategory(other);
    const top = await makeCategory(user);
    const child = await makeCategory(user, { parentId: top.id });
    const deleted = await makeCategory(user);
    await db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(eq(categories.id, deleted.id));

    for (const parentId of ["missing", foreign.id, child.id, deleted.id]) {
      await expectTRPCError(
        callerFor(user).categories.create({ ...base, parentId }),
        "BAD_REQUEST",
        "fields_integrity_parent_not_allowed",
      );
    }
  });

  it("allows a parent shared read-only with the user", async () => {
    const owner = await createUser();
    const user = await createUser();
    const shared = await makeCategory(owner);
    await grant("category", shared.id, user);

    await expect(
      callerFor(user).categories.create({ ...base, parentId: shared.id }),
    ).resolves.toBeTruthy();
  });
});

describe("categories.update", () => {
  it("changes name, flags and parent", async () => {
    const user = await createUser();
    const parent = await makeCategory(user);
    const category = await makeCategory(user);

    const updated = await callerFor(user).categories.update({
      id: category.id,
      name: "Renamed",
      parentId: parent.id,
      isExpense: false,
      isIncome: true,
    });

    expect(updated).toMatchObject({
      name: "Renamed",
      parentId: parent.id,
      isExpense: false,
      isIncome: true,
    });
  });

  it("refuses itself as parent", async () => {
    const user = await createUser();
    const category = await makeCategory(user);

    await expectTRPCError(
      callerFor(user).categories.update({
        ...base,
        id: category.id,
        parentId: category.id,
      }),
      "BAD_REQUEST",
      "fields_integrity_self_parent",
    );
  });

  it("refuses to give a parent to a category that has children", async () => {
    const user = await createUser();
    const parent = await makeCategory(user);
    await makeCategory(user, { parentId: parent.id });
    const other = await makeCategory(user);

    await expectTRPCError(
      callerFor(user).categories.update({
        ...base,
        id: parent.id,
        parentId: other.id,
      }),
      "BAD_REQUEST",
      "category_parent_has_children",
    );
  });

  it("needs write access", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const category = await makeCategory(owner);
    await grant("category", category.id, reader);

    await expectTRPCError(
      callerFor(reader).categories.update({ ...base, id: category.id }),
      "FORBIDDEN",
    );
    await expectTRPCError(
      callerFor(await createUser()).categories.update({
        ...base,
        id: category.id,
      }),
      "FORBIDDEN",
    );
  });
});

describe("categories.delete", () => {
  it("soft-deletes and audits", async () => {
    const user = await createUser();
    const category = await makeCategory(user);

    await callerFor(user).categories.delete({ id: category.id });

    const row = await db.query.categories.findFirst({
      where: eq(categories.id, category.id),
    });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(await callerFor(user).categories.list()).toEqual([]);
  });

  it("refuses a parent with live children", async () => {
    const user = await createUser();
    const parent = await makeCategory(user);
    const child = await makeCategory(user, { parentId: parent.id });

    await expectTRPCError(
      callerFor(user).categories.delete({ id: parent.id }),
      "BAD_REQUEST",
      "category_has_children",
    );

    await callerFor(user).categories.delete({ id: child.id });
    await expect(
      callerFor(user).categories.delete({ id: parent.id }),
    ).resolves.toBeUndefined();
  });

  it("needs write access", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const category = await makeCategory(owner);
    await grant("category", category.id, reader);

    await expectTRPCError(
      callerFor(reader).categories.delete({ id: category.id }),
      "FORBIDDEN",
    );
  });
});

describe("categories.list", () => {
  it("sorts by the Parent / Child display name", async () => {
    const user = await createUser({ locale: "uk" });
    const home = await makeCategory(user, { name: "Дім" });
    await makeCategory(user, { name: "Ремонт", parentId: home.id });
    await makeCategory(user, { name: "Авто" });
    await makeCategory(user, { name: "Їжа" });

    const rows = await callerFor(user).categories.list();

    expect(rows.map((row) => row.displayName)).toEqual([
      "Авто",
      "Дім",
      "Дім / Ремонт",
      "Їжа",
    ]);
  });

  it("returns only readable categories, with write and sharing flags", async () => {
    const owner = await createUser({ name: "Olena" });
    const user = await createUser();
    const mine = await makeCategory(user, { name: "Mine" });
    const shared = await makeCategory(owner, { name: "Shared" });
    await makeCategory(owner, { name: "Hidden" });
    await grant("category", shared.id, user);

    const rows = await callerFor(user).categories.list();

    expect(rows).toMatchObject([
      { id: mine.id, canWrite: true, isOwn: true, isShared: false },
      {
        id: shared.id,
        canWrite: false,
        isOwn: false,
        isShared: true,
        ownerName: "Olena",
      },
    ]);
  });

  it("reports the live child count", async () => {
    const user = await createUser();
    const parent = await makeCategory(user, { name: "A" });
    await makeCategory(user, { name: "B", parentId: parent.id });

    const [row] = await callerFor(user).categories.list();
    expect(row?.childCount).toBe(1);
  });
});

const categoryOf = async (id: string) =>
  (await db.query.transactions.findFirst({ where: eq(transactions.id, id) }))
    ?.categoryId;

const liveBudgets = (userId: string) =>
  db
    .select({
      categoryId: budgets.categoryId,
      currencyId: budgets.currencyId,
      amount: budgets.amount,
    })
    .from(budgets)
    .where(and(eq(budgets.userId, userId), isNull(budgets.deletedAt)));

describe("categories.replace", () => {
  it("moves transactions and schedules, then deletes the source", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const source = await makeCategory(user);
    const target = await makeCategory(user);

    const live = await insertTransactionRow({
      accountId: account.id,
      amount: -100,
      categoryId: source.id,
      createdBy: user.id,
    });
    const planned = await insertTransactionRow({
      accountId: account.id,
      amount: -200,
      categoryId: source.id,
      isPlanned: true,
      createdBy: user.id,
    });
    const deleted = await insertTransactionRow({
      accountId: account.id,
      amount: -300,
      categoryId: source.id,
      deletedAt: new Date(),
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
        categoryId: source.id,
        createdBy: user.id,
      })
      .returning();

    const result = await callerFor(user).categories.replace({
      sourceId: source.id,
      targetId: target.id,
    });

    expect(result.moved).toBe(3);
    expect(await categoryOf(live.id)).toBe(target.id);
    expect(await categoryOf(planned.id)).toBe(target.id);
    // a later restore lands on a live category
    expect(await categoryOf(deleted.id)).toBe(target.id);

    const movedSchedule = await db.query.plannedTransactions.findFirst({
      where: eq(plannedTransactions.id, schedule?.id ?? ""),
    });
    expect(movedSchedule?.categoryId).toBe(target.id);

    const sourceRow = await db.query.categories.findFirst({
      where: eq(categories.id, source.id),
    });
    expect(sourceRow?.deletedAt).toBeInstanceOf(Date);

    const logs = await db
      .select()
      .from(historyLogs)
      .where(
        and(
          eq(historyLogs.entityId, source.id),
          eq(historyLogs.action, "delete"),
        ),
      );
    expect(logs).toMatchObject([
      {
        entityType: "category",
        payload: { replacedBy: target.id, transactions: 3, schedules: 1 },
      },
    ]);
  });

  it("moves the user's budgets, adding to one the target already has", async () => {
    const user = await createUser();
    const source = await makeCategory(user);
    const target = await makeCategory(user);
    const caller = callerFor(user);

    await caller.budgets.save({
      categoryId: source.id,
      currencyId: CURRENCY.UAH,
      amount: 1000,
    });
    await caller.budgets.save({
      categoryId: source.id,
      currencyId: CURRENCY.USD,
      amount: 50,
    });
    await caller.budgets.save({
      categoryId: target.id,
      currencyId: CURRENCY.UAH,
      amount: 500,
    });

    await caller.categories.replace({
      sourceId: source.id,
      targetId: target.id,
    });

    const rows = await liveBudgets(user.id);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { categoryId: target.id, currencyId: CURRENCY.UAH, amount: 1500 },
        { categoryId: target.id, currencyId: CURRENCY.USD, amount: 50 },
      ]),
    );
  });

  it("drops budgets when the target is not an expense category", async () => {
    const user = await createUser();
    const source = await makeCategory(user, {
      isExpense: true,
      isIncome: true,
    });
    const target = await makeCategory(user, {
      isExpense: false,
      isIncome: true,
    });
    const caller = callerFor(user);

    await caller.budgets.save({
      categoryId: source.id,
      currencyId: CURRENCY.UAH,
      amount: 1000,
    });

    await caller.categories.replace({
      sourceId: source.id,
      targetId: target.id,
    });

    expect(await liveBudgets(user.id)).toEqual([]);
  });

  it("refuses a target that can't hold the moved kinds", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    const source = await makeCategory(user, {
      isExpense: true,
      isIncome: true,
    });
    const target = await makeCategory(user, {
      isExpense: false,
      isIncome: true,
    });
    const row = await insertTransactionRow({
      accountId: account.id,
      amount: -100,
      categoryId: source.id,
      createdBy: user.id,
    });

    await expectTRPCError(
      callerFor(user).categories.replace({
        sourceId: source.id,
        targetId: target.id,
      }),
      "BAD_REQUEST",
      "category_replace_kind_mismatch",
    );
    expect(await categoryOf(row.id)).toBe(source.id);
  });

  it("refuses itself, a parent with children and a read-only target", async () => {
    const owner = await createUser();
    const user = await createUser();
    const parent = await makeCategory(user);
    await makeCategory(user, { parentId: parent.id });
    const source = await makeCategory(user);
    const readOnly = await makeCategory(owner);
    await grant("category", readOnly.id, user);
    const caller = callerFor(user);

    await expectTRPCError(
      caller.categories.replace({ sourceId: source.id, targetId: source.id }),
      "BAD_REQUEST",
      "category_replace_self",
    );
    await expectTRPCError(
      caller.categories.replace({ sourceId: parent.id, targetId: source.id }),
      "BAD_REQUEST",
      "category_has_children",
    );
    await expectTRPCError(
      caller.categories.replace({ sourceId: source.id, targetId: readOnly.id }),
      "FORBIDDEN",
    );
  });

  it("leaves rows on accounts the user can't write", async () => {
    const owner = await createUser();
    const member = await createUser();
    const shared = await makeCategory(owner);
    await grant("category", shared.id, member, { canWrite: true });
    const target = await makeCategory(member);
    const ownersAccount = await makeAccount(owner);
    const membersAccount = await makeAccount(member);

    const theirs = await insertTransactionRow({
      accountId: ownersAccount.id,
      amount: -100,
      categoryId: shared.id,
      createdBy: owner.id,
    });
    const mine = await insertTransactionRow({
      accountId: membersAccount.id,
      amount: -100,
      categoryId: shared.id,
      createdBy: member.id,
    });

    const result = await callerFor(member).categories.replace({
      sourceId: shared.id,
      targetId: target.id,
    });

    expect(result.moved).toBe(1);
    expect(await categoryOf(mine.id)).toBe(target.id);
    expect(await categoryOf(theirs.id)).toBe(shared.id);
  });
});

describe("categories.setHidden", () => {
  it("is the member's own choice", async () => {
    const owner = await createUser();
    const reader = await createUser();
    const category = await makeCategory(owner);
    await grant("category", category.id, reader);

    // read access is enough
    await callerFor(reader).categories.setHidden({
      id: category.id,
      hidden: true,
    });

    expect(await callerFor(reader).categories.list()).toMatchObject([
      { id: category.id, isHidden: true },
    ]);
    expect(await callerFor(owner).categories.list()).toMatchObject([
      { id: category.id, isHidden: false },
    ]);

    await callerFor(reader).categories.setHidden({
      id: category.id,
      hidden: false,
    });
    expect(await callerFor(reader).categories.list()).toMatchObject([
      { id: category.id, isHidden: false },
    ]);
  });

  it("needs read access", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const category = await makeCategory(owner);

    await expectTRPCError(
      callerFor(stranger).categories.setHidden({
        id: category.id,
        hidden: true,
      }),
      "FORBIDDEN",
    );
  });
});
