import { describe, expect, it } from "vitest";

import { dueJobs } from "../../scripts/cron-schedule";

const KYIV = "Europe/Kyiv";

const paths = (instant: string, lastRun = new Map<string, string>()) =>
  dueJobs(new Date(instant), KYIV, lastRun).map((job) => job.path);

describe("dueJobs", () => {
  it("fires at the local minute, not the UTC one", () => {
    // 00:00:30 and 09:00:59 in Kyiv (UTC+2 in winter)
    expect(paths("2026-01-15T22:00:30Z")).toEqual(["/api/cron/daily-0000"]);
    expect(paths("2026-01-16T07:00:59Z")).toEqual(["/api/cron/daily-0900"]);
    // UTC midnight and 09:00 are 02:00 and 11:00 there
    expect(paths("2026-01-16T00:00:00Z")).toEqual([]);
    expect(paths("2026-01-16T09:00:00Z")).toEqual([]);
  });

  it("uses whatever zone it is given", () => {
    const due = dueJobs(new Date("2026-01-16T09:00:00Z"), "UTC", new Map());

    expect(due.map((job) => job.path)).toEqual(["/api/cron/daily-0900"]);
  });

  it("does not run a job twice on the same local day", () => {
    const ran = new Map([["/api/cron/daily-0000", "2026-01-16"]]);

    expect(paths("2026-01-15T22:00:40Z", ran)).toEqual([]);
    // the next local day it is due again
    expect(paths("2026-01-16T22:00:00Z", ran)).toEqual([
      "/api/cron/daily-0000",
    ]);
  });

  it("never catches up on a missed minute", () => {
    // a container started at 09:01 or 10:00 must not resend the 09:00 emails
    expect(paths("2026-01-16T07:01:00Z")).toEqual([]);
    expect(paths("2026-01-16T08:00:00Z")).toEqual([]);
  });

  it("follows the clock across both DST switches", () => {
    // 29 March 2026: 03:00 -> 04:00, so midnight is UTC+2 and 09:00 is UTC+3
    expect(paths("2026-03-28T22:00:00Z")).toEqual(["/api/cron/daily-0000"]);
    expect(paths("2026-03-29T06:00:00Z")).toEqual(["/api/cron/daily-0900"]);
    // 25 October 2026: 04:00 -> 03:00, so midnight is UTC+3 and 09:00 is UTC+2
    expect(paths("2026-10-24T21:00:00Z")).toEqual(["/api/cron/daily-0000"]);
    expect(paths("2026-10-25T07:00:00Z")).toEqual(["/api/cron/daily-0900"]);
  });
});
