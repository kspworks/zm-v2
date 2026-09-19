import { describe, expect, it } from "vitest";

import {
  buildBalanceSeries,
  buildForecast,
  clampRange,
  type DashboardEntry,
  forecastWindow,
} from "~/lib/dashboard";

let n = 0;
const entry = (overrides: Partial<DashboardEntry>): DashboardEntry => ({
  id: String(++n),
  kind: "expense",
  date: "2026-03-10",
  planned: false,
  net: -100,
  category: null,
  comment: null,
  counterparty: null,
  fromAccount: null,
  toAccount: null,
  ...overrides,
});

const TODAY = "2026-03-10";

describe("buildBalanceSeries", () => {
  it("splits actual and planned at today and re-dates overdue rows", () => {
    const points = buildBalanceSeries({
      opening: 1000,
      start: "2026-03-08",
      end: "2026-03-12",
      today: TODAY,
      entries: [
        entry({ date: "2026-03-08", net: -100 }),
        entry({ date: "2026-03-10", net: 50 }),
        // overdue planned: counts on today, on the planned line only
        entry({ date: "2026-03-05", planned: true, net: -200 }),
        entry({ date: "2026-03-11", planned: true, net: -300 }),
        // submitted in the future: planned line
        entry({ date: "2026-03-12", net: 40 }),
      ],
    });

    expect(
      points.map(({ date, actual, planned }) => ({ date, actual, planned })),
    ).toEqual([
      { date: "2026-03-08", actual: 900, planned: null },
      { date: "2026-03-09", actual: 900, planned: null },
      { date: "2026-03-10", actual: 950, planned: 750 },
      { date: "2026-03-11", actual: null, planned: 450 },
      { date: "2026-03-12", actual: null, planned: 490 },
    ]);

    const today = points[2];
    expect(today?.items.map((i) => [i.net, i.overdue])).toEqual([
      [50, false],
      [-200, true],
    ]);
  });

  it("drops zero-net entries and caps the items per day", () => {
    const [point] = buildBalanceSeries({
      opening: 0,
      start: TODAY,
      end: TODAY,
      today: TODAY,
      cap: 2,
      entries: [
        entry({ net: 0, kind: "transfer" }),
        entry({ net: -1 }),
        entry({ net: -30 }),
        entry({ net: -20 }),
      ],
    });

    expect(point?.items.map((i) => i.net)).toEqual([-30, -20]);
    expect(point?.more).toBe(1);
    expect(point?.actual).toBe(-51);
  });
});

describe("buildForecast", () => {
  it("buckets by month and reconciles the month-end balance", () => {
    const months = buildForecast({
      opening: 1000,
      today: TODAY,
      months: 3,
      entries: [
        entry({ date: "2026-03-02", net: -100 }),
        entry({ date: "2026-02-20", planned: true, net: -50 }),
        entry({ date: "2026-03-25", planned: true, net: 500 }),
        entry({ date: "2026-04-01", planned: true, net: -200 }),
        entry({ date: "2026-05-31", planned: true, net: 300 }),
        entry({ date: "2026-06-01", planned: true, net: 9999 }),
      ],
    });

    expect(months).toEqual([
      { month: "2026-03", income: 500, expense: -150, balance: 1350 },
      { month: "2026-04", income: 0, expense: -200, balance: 1150 },
      { month: "2026-05", income: 300, expense: 0, balance: 1450 },
    ]);
  });

  it("spans the current month and the next ones", () => {
    expect(forecastWindow("2026-11-17", 3)).toEqual({
      start: "2026-11-01",
      end: "2027-01-31",
    });
  });
});

describe("clampRange", () => {
  it.each([
    [0, 1],
    [14, 14],
    [500, 90],
    [Number.NaN, 1],
  ])("%d -> %d", (input, expected) => {
    expect(clampRange(input)).toBe(expected);
  });
});
