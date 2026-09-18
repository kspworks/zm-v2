import { describe, it } from "vitest";

import { anonymousCaller } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";

type Caller = ReturnType<typeof anonymousCaller>;

/**
 * Every protected procedure, called anonymously with a well-formed input,
 * must answer UNAUTHORIZED before doing anything else. Extend this table
 * with each new procedure.
 */
const PROTECTED: [string, (caller: Caller) => Promise<unknown>][] = [
  ["me.get", (c) => c.me.get()],
  ["me.setLocale", (c) => c.me.setLocale({ locale: "en" })],
  ["accounts.list", (c) => c.accounts.list()],
  ["accounts.currencies", (c) => c.accounts.currencies()],
  ["accounts.create", (c) => c.accounts.create({ name: "x", currencyId: "x" })],
  [
    "accounts.update",
    (c) => c.accounts.update({ id: "x", name: "x", currencyId: "x" }),
  ],
  [
    "accounts.setActive",
    (c) => c.accounts.setActive({ id: "x", isActive: true }),
  ],
  ["accounts.delete", (c) => c.accounts.delete({ id: "x" })],
  ["categories.list", (c) => c.categories.list()],
  ["categories.create", (c) => c.categories.create({ name: "x" })],
  ["categories.update", (c) => c.categories.update({ id: "x", name: "x" })],
  ["categories.delete", (c) => c.categories.delete({ id: "x" })],
  ["counterparties.list", (c) => c.counterparties.list()],
  ["counterparties.balances", (c) => c.counterparties.balances()],
  [
    "counterparties.rename",
    (c) => c.counterparties.rename({ id: "x", name: "x" }),
  ],
  [
    "counterparties.merge",
    (c) => c.counterparties.merge({ sourceId: "x", targetId: "y" }),
  ],
  ["counterparties.delete", (c) => c.counterparties.delete({ id: "x" })],
  ["sharing.list", (c) => c.sharing.list({ entity: "account", id: "x" })],
  [
    "sharing.add",
    (c) =>
      c.sharing.add({
        entity: "account",
        id: "x",
        email: "a@b.co",
        canWrite: false,
      }),
  ],
  [
    "sharing.revoke",
    (c) => c.sharing.revoke({ entity: "account", id: "x", userId: "y" }),
  ],
];

describe("protected procedures reject anonymous callers", () => {
  it.each(PROTECTED)("%s", async (_name, call) => {
    await expectTRPCError(call(anonymousCaller()), "UNAUTHORIZED");
  });
});
