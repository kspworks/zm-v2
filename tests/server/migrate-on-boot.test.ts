import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { migrateOnBoot } from "~/server/migrate-on-boot";

const dirs: string[] = [];

const bootDir = ({ sentinel = true, migrations = true } = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), "zm-boot-"));
  dirs.push(dir);

  if (migrations) {
    cpSync(path.join(process.cwd(), "drizzle"), path.join(dir, "drizzle"), {
      recursive: true,
    });
  }

  if (sentinel) {
    writeFileSync(path.join(dir, "RUN_MIGRATIONS"), "");
  }

  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("migrateOnBoot", () => {
  it("does nothing without the sentinel", async () => {
    expect(await migrateOnBoot(bootDir({ sentinel: false }))).toBe(false);
  });

  it("applies migrations (idempotently) and removes the sentinel", async () => {
    const dir = bootDir();

    expect(await migrateOnBoot(dir)).toBe(true);
    expect(existsSync(path.join(dir, "RUN_MIGRATIONS"))).toBe(false);
  });

  it("lets only one of several booting processes do the work", async () => {
    const dir = bootDir();

    const results = await Promise.all([
      migrateOnBoot(dir),
      migrateOnBoot(dir),
      migrateOnBoot(dir),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("keeps the sentinel when the migration fails", async () => {
    const dir = bootDir({ migrations: false });

    await expect(migrateOnBoot(dir)).rejects.toThrow();
    expect(existsSync(path.join(dir, "RUN_MIGRATIONS"))).toBe(true);
  });
});
