import { describe, expect, it } from "vitest";

import {
  defaultPeriods,
  isWholeMonth,
  monthOf,
  shiftPeriod,
} from "~/lib/period";

describe("period", () => {
  it("steps whole months, month ends included", () => {
    const january = monthOf("2026-01-31");

    expect(january).toEqual({ startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(shiftPeriod(january, 1)).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
    expect(shiftPeriod(january, -1)).toEqual({
      startDate: "2025-12-01",
      endDate: "2025-12-31",
    });
  });

  it("shifts any other range by its own length", () => {
    const range = { startDate: "2026-02-25", endDate: "2026-03-03" };

    expect(isWholeMonth(range)).toBe(false);
    expect(shiftPeriod(range, 1)).toEqual({
      startDate: "2026-03-04",
      endDate: "2026-03-10",
    });
    expect(shiftPeriod(range, -1)).toEqual({
      startDate: "2026-02-18",
      endDate: "2026-02-24",
    });
  });

  it("defaults to last month vs this month", () => {
    expect(defaultPeriods("2026-03-15")).toEqual([
      { startDate: "2026-02-01", endDate: "2026-02-28" },
      { startDate: "2026-03-01", endDate: "2026-03-31" },
    ]);
  });
});
