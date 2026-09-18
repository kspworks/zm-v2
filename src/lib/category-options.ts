export type CategoryLike = {
  id: string;
  name: string;
  parentId: string | null;
  parentName?: string | null;
  isExpense: boolean;
  isIncome: boolean;
};

export type CategoryOption = CategoryLike & { label: string };

/**
 * Select options everywhere: parents plus children, children labelled
 * "Parent → Child", sorted by that label. `kind` keeps only expense or income
 * categories.
 */
export const categoryOptions = (
  categories: CategoryLike[],
  locale: string,
  kind?: "expense" | "income",
): CategoryOption[] => {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const collator = new Intl.Collator(locale);

  return categories
    .filter((category) =>
      kind === "expense"
        ? category.isExpense
        : kind === "income"
          ? category.isIncome
          : true,
    )
    .map((category) => {
      const parentName = category.parentId
        ? (byId.get(category.parentId)?.name ?? category.parentName ?? null)
        : null;

      return {
        ...category,
        label: parentName ? `${parentName} → ${category.name}` : category.name,
      };
    })
    .sort((a, b) => collator.compare(a.label, b.label));
};
