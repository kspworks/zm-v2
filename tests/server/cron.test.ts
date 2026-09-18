import { describe, expect, it } from "vitest";

import { GET } from "~/app/api/cron/daily-0000/route";
import { isCronAuthorized } from "~/server/cron";
import { db } from "~/server/db";
import { rateLimits } from "~/server/db/schema";
import { callerFor } from "../helpers/caller";
import { createUser, makeAccount } from "../helpers/fixtures";

const SECRET = process.env.CRON_SECRET ?? "";

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost:3000/api/cron/daily-0000", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("cron auth", () => {
  it("refuses a missing or wrong secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
    expect((await call(`Bearer ${SECRET}x`)).status).toBe(401);
    expect((await call(`bearer ${SECRET}`)).status).toBe(401);
  });

  it("refuses everything when no secret is configured", () => {
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
  });

  it("compares the whole value", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isCronAuthorized(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(
      false,
    );
    expect(isCronAuthorized(null, SECRET)).toBe(false);
  });
});

describe("daily-0000", () => {
  it("regenerates planned occurrences and sweeps old rate-limit windows", async () => {
    const user = await createUser();
    const account = await makeAccount(user);
    await callerFor(user).planned.create({
      data: {
        kind: "expense",
        date: "2026-03-20",
        amount: 1,
        accountId: account.id,
      },
      schedule: {
        repeatType: "daily",
        repeatInterval: 1,
        endDate: "2026-03-22",
      },
    });
    await db.insert(rateLimits).values([
      {
        key: "old",
        count: 1,
        windowStart: new Date(Date.now() - 48 * 3600_000),
      },
      { key: "fresh", count: 1, windowStart: new Date() },
    ]);

    const response = await call(`Bearer ${SECRET}`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(text).toMatch(
      /^\[CRON\] \[daily-0000\] \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} - planned: 0 occurrences for 1 schedules/m,
    );
    expect(text).toContain("swept 1 app");
    expect(text).toMatch(/done in \d+ms/);
    expect((await db.select().from(rateLimits)).map((r) => r.key)).toEqual([
      "fresh",
    ]);
  });
});
