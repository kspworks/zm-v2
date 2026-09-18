import type { DbOrTx } from "~/server/db";
import { accountMembers, accounts } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";

export type AccountType = (typeof accounts.$inferSelect)["type"];

export type AccountInsert = {
  name: string;
  type: AccountType;
  currencyId: string;
  initialBalance: number;
  isActive: boolean;
  importId?: string | null;
};

/**
 * Inserts an account plus the creator's read+write member row (an account
 * without one would be invisible to everyone) and the audit row. Pass the
 * caller's transaction handle.
 */
export const insertAccount = async (
  tx: DbOrTx,
  { userId, values }: { userId: string; values: AccountInsert },
) => {
  const [account] = await tx
    .insert(accounts)
    .values({ ...values, name: values.name.trim(), createdBy: userId })
    .returning();

  if (!account) {
    throw new Error("Account insert returned no row");
  }

  await tx.insert(accountMembers).values({
    accountId: account.id,
    userId,
    canRead: true,
    canWrite: true,
  });

  await audit(tx, {
    entityType: "account",
    entityId: account.id,
    action: "create",
    userId,
    payload: values,
  });

  return account;
};
