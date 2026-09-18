import { describe, expect, it } from "vitest";

import { occurrenceDates, scheduleHorizon } from "~/lib/schedule";

const rule = {
  startDate: "2026-01-01",
  endDate: null,
  repeatType: "daily" as const,
  repeatInterval: 1,
  repeatWeekdays: [],
};

describe("scheduleHorizon", () => {
  it("is a year from today without an end date", () => {
    expect(scheduleHorizon(rule, "2026-03-15")).toBe("2027-03-15");
  });

  it("is the end date when that comes first", () => {
    expect(
      scheduleHorizon({ ...rule, endDate: "2026-04-01" }, "2026-03-15"),
    ).toBe("2026-04-01");
  });
});

describe("occurrenceDates", () => {
  it("daily with an interval", () => {
    expect(
      occurrenceDates(
        { ...rule, repeatInterval: 3, endDate: "2026-01-10" },
        "2026-01-01",
      ),
    ).toEqual(["2026-01-01", "2026-01-04", "2026-01-07", "2026-01-10"]);
  });

  it("monthly from the start, without month-end drift", () => {
    expect(
      occurrenceDates(
        {
          ...rule,
          startDate: "2026-01-31",
          repeatType: "monthly",
          endDate: "2026-05-31",
        },
        "2026-01-01",
      ),
    ).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("yearly, including Feb 29", () => {
    expect(
      occurrenceDates(
        {
          ...rule,
          startDate: "2028-02-29",
          repeatType: "yearly",
          endDate: "2032-12-31",
        },
        "2028-01-01",
      ),
    ).toEqual(["2028-02-29"]);
    expect(
      occurrenceDates(
        {
          ...rule,
          startDate: "2026-02-10",
          repeatType: "yearly",
          repeatInterval: 1,
        },
        "2026-06-01",
      ),
    ).toEqual(["2026-02-10", "2027-02-10"]);
  });

  it("weekly on selected weekdays within the Monday-started week", () => {
    // 2026-01-07 is a Wednesday
    expect(
      occurrenceDates(
        {
          ...rule,
          startDate: "2026-01-07",
          repeatType: "weekly",
          repeatWeekdays: [1, 3, 5],
          endDate: "2026-01-19",
        },
        "2026-01-01",
      ),
    ).toEqual([
      // Monday 5th is before the start, so it's skipped
      "2026-01-07",
      "2026-01-09",
      "2026-01-12",
      "2026-01-14",
      "2026-01-16",
      "2026-01-19",
    ]);
  });

  it("never overshoots the end date inside the last week", () => {
    const dates = occurrenceDates(
      {
        ...rule,
        startDate: "2026-01-05",
        repeatType: "weekly",
        repeatWeekdays: [1, 7],
        endDate: "2026-01-14",
      },
      "2026-01-01",
    );

    // Sunday the 18th is in the last week but past the end date
    expect(dates).toEqual(["2026-01-05", "2026-01-11", "2026-01-12"]);
  });

  it("weekly every 2 weeks", () => {
    expect(
      occurrenceDates(
        {
          ...rule,
          startDate: "2026-01-05",
          repeatType: "weekly",
          repeatInterval: 2,
          repeatWeekdays: [4],
          endDate: "2026-02-05",
        },
        "2026-01-01",
      ),
    ).toEqual(["2026-01-08", "2026-01-22", "2026-02-05"]);
  });

  it("stops at today + 1 year", () => {
    const dates = occurrenceDates(
      { ...rule, startDate: "2026-01-01", repeatType: "monthly" },
      "2026-03-15",
    );

    expect(dates[0]).toBe("2026-01-01");
    expect(dates.at(-1)).toBe("2027-03-01");
    expect(dates).toHaveLength(15);
  });

  it("returns nothing when the start is past the horizon", () => {
    expect(
      occurrenceDates({ ...rule, startDate: "2028-01-01" }, "2026-01-01"),
    ).toEqual([]);
  });
});
