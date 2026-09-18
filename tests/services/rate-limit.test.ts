import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "~/server/db";
import { rateLimits } from "~/server/db/schema";
import {
  hitRateLimit,
  resetRateLimit,
  sweepRateLimits,
} from "~/server/lib/rate-limit";

const rule = { limit: 3, windowMs: 60_000 };

afterEach(() => {
  vi.useRealTimers();
});

describe("hitRateLimit", () => {
  it("counts attempts and blocks past the limit", async () => {
    const results = [];

    for (let i = 0; i < 4; i++) {
      results.push(await hitRateLimit("k", rule));
    }

    expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4]);
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
  });

  it("starts a new window once the old one expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));

    await hitRateLimit("k", rule);
    await hitRateLimit("k", rule);
    await hitRateLimit("k", rule);
    expect((await hitRateLimit("k", rule)).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T10:01:00Z"));
    const fresh = await hitRateLimit("k", rule);

    expect(fresh).toEqual({ allowed: true, count: 1 });

    const [row] = await db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.key, "k"));
    expect(row?.windowStart.toISOString()).toBe("2026-01-01T10:01:00.000Z");
  });

  it("keeps keys independent", async () => {
    await hitRateLimit("a", rule);
    await hitRateLimit("a", rule);

    expect((await hitRateLimit("b", rule)).count).toBe(1);
  });

  it("never loses an update under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        hitRateLimit("race", { limit: 10, windowMs: 60_000 }),
      ),
    );

    const counts = results.map((r) => r.count).sort((a, b) => a - b);

    expect(counts).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it("resets a key", async () => {
    await hitRateLimit("k", rule);
    await hitRateLimit("k", rule);
    await resetRateLimit("k");

    expect((await hitRateLimit("k", rule)).count).toBe(1);
  });
});

describe("sweepRateLimits", () => {
  it("deletes windows older than 24 h only", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await hitRateLimit("old", rule);

    vi.setSystemTime(new Date("2026-01-01T23:00:00Z"));
    await hitRateLimit("recent", rule);

    vi.setSystemTime(new Date("2026-01-02T00:30:00Z"));
    expect(await sweepRateLimits()).toBe(1);

    const keys = (await db.select().from(rateLimits)).map((r) => r.key);
    expect(keys).toEqual(["recent"]);
  });
});
