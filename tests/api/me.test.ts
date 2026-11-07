import { describe, expect, it } from "vitest";

import { callerFor } from "../helpers/caller";
import { expectTRPCError } from "../helpers/errors";
import { CURRENCY, createUser } from "../helpers/fixtures";

describe("me.primaryCurrency", () => {
  it("stores the chosen currency", async () => {
    const user = await createUser();

    await callerFor(user).me.setPrimaryCurrency({ currencyId: CURRENCY.USD });

    await expect(callerFor(user).me.primaryCurrency()).resolves.toEqual({
      currencyId: CURRENCY.USD,
    });
  });

  it("refuses an unknown currency", async () => {
    const user = await createUser();

    await expectTRPCError(
      callerFor(user).me.setPrimaryCurrency({ currencyId: "missing" }),
      "BAD_REQUEST",
      "invalid_value",
    );
  });
});
