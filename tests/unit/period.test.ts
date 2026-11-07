import { describe, expect, it } from "vitest";

import {
  defaultPeriods,
  isWholeMonth,
  monthOf,
  presetPeriod,
  sameDays,
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

  it("cuts both periods to the days of the running one that have passed", () => {
    const periods = defaultPeriods("2026-03-07");

    expect(sameDays(periods, "2026-03-07")).toEqual({
      days: 7,
      periods: [
        { startDate: "2026-02-01", endDate: "2026-02-07" },
        { startDate: "2026-03-01", endDate: "2026-03-07" },
      ],
    });
  });

  it("never runs past the end of the shorter period", () => {
    const periods = defaultPeriods("2026-03-30");

    expect(sameDays(periods, "2026-03-30")?.periods[0]).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
  });

  it("notices a running period on either side", () => {
    const [last, current] = defaultPeriods("2026-03-07");

    expect(sameDays([current, last], "2026-03-07")?.days).toBe(7);
  });

  it("leaves periods that are over alone", () => {
    expect(sameDays(defaultPeriods("2026-03-31"), "2026-03-31")).toBeNull();
    expect(sameDays(defaultPeriods("2026-03-15"), "2026-05-01")).toBeNull();
  });

  it("resolves the quick ranges", () => {
    const today = "2026-03-15";

    expect(presetPeriod("thisMonth", today)).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
    });
    expect(presetPeriod("lastMonth", today)).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
    expect(presetPeriod("last30Days", today)).toEqual({
      startDate: "2026-02-14",
      endDate: today,
    });
    expect(presetPeriod("thisYear", today)).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
  });

  it("defaults to last month vs this month", () => {
    expect(defaultPeriods("2026-03-15")).toEqual([
      { startDate: "2026-02-01", endDate: "2026-02-28" },
      { startDate: "2026-03-01", endDate: "2026-03-31" },
    ]);
  });
});
