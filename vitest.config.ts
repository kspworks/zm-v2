import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Node's loader leaves already-set variables alone, so CI can override
// DATABASE_URL. This runs before the workers fork, so globalSetup and every
// worker inherit the values.
process.loadEnvFile(fileURLToPath(new URL(".env.test", import.meta.url)));

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^~\//, replacement: src("./src/") },
      // the real package throws outside the react-server condition
      { find: /^server-only$/, replacement: src("./tests/setup/empty.ts") },
    ],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // postgres-js holds sockets, so processes are safer than worker threads
    pool: "forks",
    // one shared database, so no concurrent writers
    fileParallelism: false,
    isolate: false,
    globalSetup: ["tests/setup/global-setup.ts"],
    setupFiles: ["tests/setup/setup-file.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    restoreMocks: true,
  },
});
