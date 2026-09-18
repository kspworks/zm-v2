export type ReportInput = {
  id: string;
  date: string;
  amount: number;
  currencyCode: string;
  currencySign: string;
  categoryId: string | null;
  categoryName: string | null;
  parentId: string | null;
  parentName: string | null;
  comment: string | null;
};

export type ReportLeaf = {
  id: string;
  name: string;
  value: number;
  date: string;
  category: string;
  comment: string | null;
};

export type ReportTile = {
  key: string;
  name: string;
  value: number;
  children: ReportLeaf[];
};

export type ReportChart = {
  currencyCode: string;
  currencySign: string;
  total: number;
  tiles: ReportTile[];
};

/**
 * One chart per currency (never summed across currencies), largest total
 * first. Expense and income are separate views: only negative or positive
 * amounts count, as absolute values. Children roll up under their parent;
 * rows without a category form a "No category" tile. Leaves are single
 * transactions. Zero-total tiles are dropped.
 */
export const buildReport = (
  rows: ReportInput[],
  view: "expense" | "income",
  labels: { noCategory: string },
): ReportChart[] => {
  const charts = new Map<
    string,
    { sign: string; tiles: Map<string, ReportTile> }
  >();

  for (const row of rows) {
    if (view === "expense" ? row.amount >= 0 : row.amount <= 0) {
      continue;
    }

    const value = Math.abs(row.amount);
    const chart = charts.get(row.currencyCode) ?? {
      sign: row.currencySign,
      tiles: new Map(),
    };
    charts.set(row.currencyCode, chart);

    const topId = row.parentId ?? row.categoryId ?? "__none__";
    const topName = row.parentName ?? row.categoryName ?? labels.noCategory;
    const tile = chart.tiles.get(topId) ?? {
      key: topId,
      name: topName,
      value: 0,
      children: [],
    };
    chart.tiles.set(topId, tile);

    tile.value += value;
    tile.children.push({
      id: row.id,
      name: row.comment ?? row.categoryName ?? labels.noCategory,
      value,
      date: row.date,
      category: row.parentName
        ? `${row.parentName} → ${row.categoryName ?? ""}`
        : (row.categoryName ?? labels.noCategory),
      comment: row.comment,
    });
  }

  return [...charts.entries()]
    .map(([currencyCode, chart]) => {
      const tiles = [...chart.tiles.values()]
        .filter((tile) => tile.value !== 0)
        .map((tile) => ({
          ...tile,
          children: tile.children.sort((a, b) => b.value - a.value),
        }))
        .sort((a, b) => b.value - a.value);

      return {
        currencyCode,
        currencySign: chart.sign,
        total: tiles.reduce((sum, tile) => sum + tile.value, 0),
        tiles,
      };
    })
    .filter((chart) => chart.total !== 0)
    .sort((a, b) => b.total - a.total);
};
