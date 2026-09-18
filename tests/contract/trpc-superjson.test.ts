import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { describe, expect, it } from "vitest";

import { GET, POST } from "~/app/api/trpc/[trpc]/route";
import type { AppRouter } from "~/server/api/root";

/**
 * Contract: a Date leaves the server as a Date and arrives as a Date, through
 * the real route handler and the real client link.
 */
const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "http://localhost:3000/api/trpc",
      transformer: superjson,
      fetch: async (input, init) => {
        const request = new Request(input as string, init as RequestInit);

        return request.method === "GET" ? GET(request) : POST(request);
      },
    }),
  ],
});

describe("tRPC + superjson", () => {
  it("round-trips a Date", async () => {
    const before = Date.now();
    const result = await client.health.ping.query();

    expect(result.ok).toBe(true);
    expect(result.at).toBeInstanceOf(Date);
    expect(result.at.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("reports UNAUTHORIZED for a protected procedure without a session", async () => {
    await expect(client.me.get.query()).rejects.toMatchObject({
      data: { code: "UNAUTHORIZED" },
    });
  });

  it("flattens zod errors into data.zodError", async () => {
    const error = await client.invites.validate
      .query({ id: "" })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      data: {
        code: "BAD_REQUEST",
        zodError: { fieldErrors: { id: expect.any(Array) } },
      },
    });
  });
});
