import { describe, expect, it } from "vitest";

import type { ReportChart, ReportLeaf, ReportTile } from "~/lib/report";
import { layoutReport, type Rect, squarify } from "~/lib/treemap-layout";

let n = 0;
const leaf = (value: number): ReportLeaf => ({
  id: String(++n),
  name: `leaf ${n}`,
  value,
  date: "2026-09-15",
  category: "Category",
  comment: null,
});

const tile = (key: string, values: number[]): ReportTile => ({
  key,
  name: key,
  value: values.reduce((a, b) => a + b, 0),
  children: values.map(leaf),
});

const chart = (...tiles: ReportTile[]): ReportChart => ({
  currencyCode: "UAH",
  currencySign: "₴",
  total: tiles.reduce((a, t) => a + t.value, 0),
  tiles,
});

const area = (r: Rect) => r.width * r.height;

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1e-6 &&
  inner.y >= outer.y - 1e-6 &&
  inner.x + inner.width <= outer.x + outer.width + 1e-6 &&
  inner.y + inner.height <= outer.y + outer.height + 1e-6;

describe("squarify", () => {
  it("gives each value an exact share of the area and fills it", () => {
    const rect = { x: 10, y: 20, width: 600, height: 300 };
    const values = [500, 300, 120, 50, 20, 10];
    const rects = squarify(values, rect);
    const total = values.reduce((a, b) => a + b, 0);

    rects.forEach((r, i) => {
      expect(area(r)).toBeCloseTo(
        (area(rect) * (values[i] as number)) / total,
        6,
      );
      expect(inside(r, rect)).toBe(true);
    });
    expect(rects.reduce((a, r) => a + area(r), 0)).toBeCloseTo(area(rect), 6);
  });
});

describe("layoutReport", () => {
  const size = { width: 663, height: 360 };

  it("keeps tile areas proportional to their totals", () => {
    const c = chart(
      tile("a", [30000, 778.1]),
      tile("b", [10000, 200]),
      tile("c", [1040]),
    );
    const { tiles } = layoutReport(c, size);

    for (const t of tiles) {
      expect(area(t)).toBeCloseTo((area(size as Rect) * t.value) / c.total, 6);
    }
  });

  it("moves a small leaf next to a dominant one into a readable band", () => {
    const small = leaf(778.1);
    const c = chart({
      key: "flat",
      name: "flat",
      value: 30778.1,
      children: [leaf(30000), small],
    });
    const { tiles, leaves } = layoutReport(
      c,
      { width: 390, height: 360 },
      { band: 26 },
    );
    const t = tiles[0] as Rect;
    const placed = leaves.find((l) => l.key === small.id);

    expect(placed).toMatchObject({
      x: t.x,
      y: t.y + t.height - 26,
      width: t.width,
      height: 26,
      leaves: [small],
    });
  });

  it("keeps the exact layout when no leaf would be thin", () => {
    const c = chart(tile("even", [100, 90, 80]));
    const { leaves } = layoutReport(c, size, { band: 26 });
    const values = [100, 90, 80];

    leaves.forEach((l, i) => {
      expect(area(l)).toBeCloseTo(
        (area(size as Rect) * (values[i] as number)) / 270,
        6,
      );
    });
  });

  it("merges the band overflow into one leaf and keeps the sums", () => {
    const values = [5000, 40, 30, 20, 15, 10, 8, 5];
    const c = chart(tile("narrow", values));
    const { leaves } = layoutReport(
      c,
      { width: 200, height: 360 },
      { band: 26, minBandItem: 64 },
    );
    const merged = leaves.filter((l) => l.leaves.length > 1);

    expect(merged).toHaveLength(1);
    expect(leaves.flatMap((l) => l.leaves)).toHaveLength(values.length);
    expect(leaves.reduce((a, l) => a + l.value, 0)).toBeCloseTo(
      values.reduce((a, b) => a + b, 0),
      6,
    );

    for (const l of leaves.filter((l) => l.height === 26)) {
      expect(l.width).toBeGreaterThanOrEqual(64 - 1e-6);
    }
  });

  it("draws no leaf thinner than the band inside a roomy tile", () => {
    const c = chart(
      tile("a", [30000, 778.1, 300]),
      tile("b", [2989.69, 2206.28, 1076.23, 429, 350, 349.78, 229, 223.77]),
    );
    const { tiles, leaves } = layoutReport(c, size, { band: 26 });

    for (const l of leaves) {
      const t = tiles.find((t) => t.key === l.tileKey) as Rect;

      expect(inside(l, t)).toBe(true);

      if (t.height >= 3 * 26 && t.width >= 64) {
        expect(Math.min(l.width, l.height)).toBeGreaterThanOrEqual(26 - 1e-6);
      }
    }
  });
});
