import { describe, expect, it } from "vitest";

import {
  calendarDateIn,
  formatDisplayDate,
  formatListDate,
  relativeDay,
} from "~/lib/dates";

describe("formatDisplayDate", () => {
  it("renders dd.MM.yyyy", () => {
    expect(formatDisplayDate("2026-03-05")).toBe("05.03.2026");
  });
});

describe("formatListDate", () => {
  it("omits the year in the current year", () => {
    expect(formatListDate("2026-03-05", "2026-09-18", "en")).toBe("5 March");
    expect(formatListDate("2026-03-05", "2026-09-18", "uk")).toBe("5 березня");
  });

  it("adds the year otherwise", () => {
    expect(formatListDate("2025-12-31", "2026-01-01", "en")).toBe(
      "31 December 2025",
    );
  });
});

describe("relativeDay", () => {
  const today = "2026-09-18"; // a Friday

  it("says today, yesterday and tomorrow within a day", () => {
    const opts = { planned: false, locale: "en" as const };

    expect(relativeDay("2026-09-18", today, opts)).toEqual({ kind: "today" });
    expect(relativeDay("2026-09-17", today, opts)).toEqual({
      kind: "yesterday",
    });
    expect(relativeDay("2026-09-19", today, opts)).toEqual({
      kind: "tomorrow",
    });
  });

  it("uses the weekday for submitted rows", () => {
    expect(
      relativeDay("2026-09-14", today, { planned: false, locale: "en" }),
    ).toEqual({ kind: "weekday", weekday: "Monday" });
    expect(
      relativeDay("2026-09-14", today, { planned: false, locale: "uk" }),
    ).toEqual({ kind: "weekday", weekday: "понеділок" });
  });

  it("counts days for planned rows", () => {
    const opts = { planned: true, locale: "en" as const };

    expect(relativeDay("2026-09-25", today, opts)).toEqual({
      kind: "inDays",
      days: 7,
    });
    expect(relativeDay("2026-09-08", today, opts)).toEqual({
      kind: "daysAgo",
      days: 10,
    });
  });
});

describe("calendarDateIn", () => {
  it("uses the given zone, not the machine's", () => {
    const instant = new Date("2026-09-18T22:30:00Z");

    expect(calendarDateIn(instant, "UTC")).toBe("2026-09-18");
    expect(calendarDateIn(instant, "Europe/Kyiv")).toBe("2026-09-19");
    expect(calendarDateIn(instant, "America/New_York")).toBe("2026-09-18");
  });
});
