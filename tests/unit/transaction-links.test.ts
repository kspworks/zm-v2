import { describe, expect, it } from "vitest";

import { filteredHref } from "~/lib/transaction-links";

describe("filteredHref", () => {
  it("writes the params the filter reads and skips empty ones", () => {
    expect(
      filteredHref("/transactions", {
        accounts: ["a", "b"],
        categories: [],
        comment: null,
        startDate: "2026-03-01",
      }),
    ).toBe("/transactions?accounts=a%2Cb&startDate=2026-03-01");
  });

  it("is the bare path without a filter", () => {
    expect(filteredHref("/planned", {})).toBe("/planned");
  });
});
