import { afterEach, beforeAll } from "vitest";

import { truncateAll } from "../helpers/db";

// a previous run may have crashed mid-test, so don't trust the starting state
beforeAll(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});
