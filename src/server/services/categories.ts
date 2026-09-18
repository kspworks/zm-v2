import type { DbOrTx } from "~/server/db";
import { categories, categoryMembers } from "~/server/db/schema";
import { audit } from "~/server/lib/audit";

export type CategoryInsert = {
  name: string;
  parentId: string | null;
  isExpense: boolean;
  isIncome: boolean;
  seedKey?: string | null;
  importId?: string | null;
};

/** Inserts a category plus the creator's read+write member row and audit row */
export const insertCategory = async (
  tx: DbOrTx,
  { userId, values }: { userId: string; values: CategoryInsert },
) => {
  const [category] = await tx
    .insert(categories)
    .values({ ...values, name: values.name.trim(), createdBy: userId })
    .returning();

  if (!category) {
    throw new Error("Category insert returned no row");
  }

  await tx.insert(categoryMembers).values({
    categoryId: category.id,
    userId,
    canRead: true,
    canWrite: true,
  });

  await audit(tx, {
    entityType: "category",
    entityId: category.id,
    action: "create",
    userId,
    payload: values,
  });

  return category;
};
