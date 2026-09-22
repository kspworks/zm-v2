import type { ReportChart, ReportLeaf } from "~/lib/report";

export type Rect = { x: number; y: number; width: number; height: number };

export type TileRect = Rect & { key: string; name: string; value: number };

/** One leaf, or several small ones merged into a "+N more" leaf. */
export type LeafRect = Rect & {
  key: string;
  tileKey: string;
  value: number;
  leaves: ReportLeaf[];
};

export type TreemapOptions = {
  /** Leaves thinner than this move into a band of this height. */
  band: number;
  /** Narrowest leaf in the band; the overflow is merged. */
  minBandItem: number;
};

const DEFAULTS: TreemapOptions = { band: 26, minBandItem: 64 };

const worst = (row: number[], side: number): number => {
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);

  return Math.max(
    (side * side * max) / (sum * sum),
    (sum * sum) / (side * side * min),
  );
};

/**
 * Squarified layout (Bruls, Huizing, van Wijk) of values sorted largest
 * first, returned in input order. Areas are exact and coordinates are not
 * rounded.
 */
export const squarify = (values: number[], rect: Rect): Rect[] => {
  const total = values.reduce((a, b) => a + b, 0);

  if (total <= 0 || rect.width <= 0 || rect.height <= 0) {
    return values.map(() => ({ ...rect, width: 0, height: 0 }));
  }

  const scale = (rect.width * rect.height) / total;
  const areas = values.map((value) => Math.max(value, 0) * scale);
  const out: Rect[] = [];
  let { x, y, width, height } = rect;
  let index = 0;

  while (index < areas.length) {
    const side = Math.min(width, height);
    const row = [areas[index] as number];
    let next = index + 1;

    while (
      next < areas.length &&
      worst([...row, areas[next] as number], side) <= worst(row, side)
    ) {
      row.push(areas[next] as number);
      next++;
    }

    const last = next === areas.length;
    const sum = row.reduce((a, b) => a + b, 0);

    if (width >= height) {
      // A column along the left edge
      const columnWidth = last || height === 0 ? width : sum / height;
      let cursor = y;

      for (const area of row) {
        const h = sum ? (area / sum) * height : 0;
        out.push({ x, y: cursor, width: columnWidth, height: h });
        cursor += h;
      }

      x += columnWidth;
      width -= columnWidth;
    } else {
      // A row along the top edge
      const rowHeight = last || width === 0 ? height : sum / width;
      let cursor = x;

      for (const area of row) {
        const w = sum ? (area / sum) * width : 0;
        out.push({ x: cursor, y, width: w, height: rowHeight });
        cursor += w;
      }

      y += rowHeight;
      height -= rowHeight;
    }

    index = next;
  }

  return out;
};

/**
 * Widths proportional to `values`, each at least `min`, summing to `total`
 * (callers guarantee `values.length * min <= total`).
 */
const bandWidths = (values: number[], total: number, min: number) => {
  const fixed = new Set<number>();

  for (;;) {
    const free = total - fixed.size * min;
    const sum = values.reduce((a, v, i) => (fixed.has(i) ? a : a + v), 0);
    const widths = values.map((v, i) =>
      fixed.has(i) ? min : sum ? (v / sum) * free : free / values.length,
    );
    const below = widths.findIndex((w, i) => !fixed.has(i) && w < min);

    if (below === -1) {
      return widths;
    }

    fixed.add(below);
  }
};

const layoutLeaves = (
  tileKey: string,
  leaves: ReportLeaf[],
  rect: Rect,
  { band, minBandItem }: TreemapOptions,
): LeafRect[] => {
  const place = (items: ReportLeaf[][], area: Rect): LeafRect[] => {
    const values = items.map((group) =>
      group.reduce((a, leaf) => a + leaf.value, 0),
    );

    return squarify(values, area).map((r, i) => ({
      ...r,
      key: (items[i] as ReportLeaf[])[0]?.id ?? String(i),
      tileKey,
      value: values[i] as number,
      leaves: items[i] as ReportLeaf[],
    }));
  };

  const exact = place(
    leaves.map((leaf) => [leaf]),
    rect,
  );

  if (rect.height < 3 * band || rect.width < minBandItem) {
    return exact;
  }

  // Moving leaves out of the main area can squeeze the rest, so repeat until
  // nothing left in it is thin; the largest leaf always stays
  let main = leaves;
  let placed = exact;
  const top = { ...rect, height: rect.height - band };

  for (;;) {
    const thin = new Set(
      placed
        .slice(1)
        .filter((r) => Math.min(r.width, r.height) < band)
        .map((r) => r.key),
    );

    if (thin.size === 0) {
      break;
    }

    main = main.filter((leaf) => !thin.has(leaf.id));
    placed = place(
      main.map((leaf) => [leaf]),
      top,
    );
  }

  if (main.length === leaves.length) {
    return exact;
  }

  const kept = new Set(main.map((leaf) => leaf.id));
  const tail = leaves.filter((leaf) => !kept.has(leaf.id));
  const slots = Math.max(1, Math.floor(rect.width / minBandItem));
  const items: ReportLeaf[][] =
    tail.length > slots
      ? [
          ...tail.slice(0, slots - 1).map((leaf) => [leaf]),
          tail.slice(slots - 1),
        ]
      : tail.map((leaf) => [leaf]);
  const values = items.map((group) =>
    group.reduce((a, leaf) => a + leaf.value, 0),
  );
  const widths = bandWidths(values, rect.width, minBandItem);
  let cursor = rect.x;

  return [
    ...placed,
    ...items.map((group, i) => {
      const width = widths[i] as number;
      const leaf: LeafRect = {
        x: cursor,
        y: rect.y + rect.height - band,
        width,
        height: band,
        key: group.length > 1 ? `more:${tileKey}` : (group[0]?.id ?? ""),
        tileKey,
        value: values[i] as number,
        leaves: group,
      };
      cursor += width;

      return leaf;
    }),
  ];
};

/**
 * Tiles are laid out with exact areas. Inside a tile, a leaf that exact
 * layout would draw thinner than `band` (a small amount next to a dominant
 * one) moves into a band of that height along the tile's bottom, where it is
 * wide enough to label and to hover, at the cost of taking a little more room
 * than its share. When the band cannot fit every such leaf at `minBandItem`,
 * the smallest ones merge into a single leaf.
 */
export const layoutReport = (
  chart: ReportChart,
  size: { width: number; height: number },
  options: Partial<TreemapOptions> = {},
): { tiles: TileRect[]; leaves: LeafRect[] } => {
  const opts = { ...DEFAULTS, ...options };
  const rects = squarify(
    chart.tiles.map((tile) => tile.value),
    { x: 0, y: 0, ...size },
  );
  const tiles = chart.tiles.map((tile, i) => ({
    ...(rects[i] as Rect),
    key: tile.key,
    name: tile.name,
    value: tile.value,
  }));

  return {
    tiles,
    leaves: chart.tiles.flatMap((tile, i) =>
      layoutLeaves(tile.key, tile.children, rects[i] as Rect, opts),
    ),
  };
};
