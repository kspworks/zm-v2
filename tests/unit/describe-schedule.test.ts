import { describe, expect, it } from "vitest";

import { describeSchedule } from "~/lib/describe-schedule";

const base = {
  repeatType: "monthly" as const,
  repeatInterval: 1,
  repeatWeekdays: [],
  endDate: null,
};

describe("describeSchedule (en)", () => {
  it.each([
    [{ repeatType: "daily" as const }, "Repeats every day"],
    [{}, "Repeats every month"],
    [
      { repeatType: "yearly" as const, repeatInterval: 1 },
      "Repeats every year",
    ],
    [
      { repeatType: "daily" as const, repeatInterval: 3 },
      "Repeats every 3 days",
    ],
    [
      {
        repeatType: "weekly" as const,
        repeatInterval: 2,
        repeatWeekdays: [4, 1],
      },
      "Repeats every 2 weeks on Mon and Thu",
    ],
    [
      { repeatType: "weekly" as const, repeatWeekdays: [1, 3, 5] },
      "Repeats every week on Mon, Wed and Fri",
    ],
  ])("%j", (overrides, text) => {
    expect(describeSchedule({ ...base, ...overrides }, "en")).toBe(text);
  });

  it("adds the end date", () => {
    expect(describeSchedule({ ...base, endDate: "2027-05-01" }, "en")).toBe(
      "Repeats every month until 01.05.2027",
    );
  });
});

describe("describeSchedule (uk)", () => {
  it.each([
    [{ repeatType: "daily" as const }, "Повторюється щодня"],
    [{}, "Повторюється щомісяця"],
    [
      { repeatType: "daily" as const, repeatInterval: 2 },
      "Повторюється кожні 2 дні",
    ],
    [
      { repeatType: "daily" as const, repeatInterval: 5 },
      "Повторюється кожні 5 днів",
    ],
    [
      { repeatType: "monthly" as const, repeatInterval: 21 },
      "Повторюється кожні 21 місяць",
    ],
    [
      {
        repeatType: "weekly" as const,
        repeatInterval: 2,
        repeatWeekdays: [1, 4],
      },
      "Повторюється кожні 2 тижні у пн і чт",
    ],
  ])("%j", (overrides, text) => {
    expect(describeSchedule({ ...base, ...overrides }, "uk")).toBe(text);
  });

  it("adds the end date", () => {
    expect(
      describeSchedule(
        { ...base, repeatType: "yearly", endDate: "2027-05-01" },
        "uk",
      ),
    ).toBe("Повторюється щороку до 01.05.2027");
  });
});
