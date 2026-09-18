import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { migrationConfig } from "../../drizzle.config";

const exec = promisify(execFile);

const COMPOSE_FILE = "docker-compose.test.yml";
const CONNECT_ATTEMPTS = 30;
const CONNECT_INTERVAL_MS = 500;

const canConnect = async (url: string): Promise<boolean> => {
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 2,
    onnotice: () => false,
  });

  try {
    await sql`select 1`;

    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
};

const startContainer = async (url: string): Promise<void> => {
  await exec("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d", "--wait"]);

  // publishing the host port can lag behind the container healthcheck
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt++) {
    if (await canConnect(url)) {
      return;
    }

    await sleep(CONNECT_INTERVAL_MS);
  }

  throw new Error(`Test database never became reachable at ${url}`);
};

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is missing - is .env.test present?");
  }

  // every test truncates the whole schema, so never let this point at a real db
  if (!url.includes("zm_test")) {
    throw new Error(`Refusing to run destructive tests against ${url}`);
  }

  if (!(await canConnect(url))) {
    // CI provides postgres as a service, so it opts out of the docker dance
    if (process.env.TEST_DB_AUTOSTART === "0") {
      throw new Error(`Test database is unreachable at ${url}`);
    }

    await startContainer(url);
  }

  const client = postgres(url, { max: 1, onnotice: () => false });

  try {
    // idempotent via __drizzle_migrations; also seeds the currencies table
    await migrate(drizzle(client), migrationConfig);
  } finally {
    await client.end({ timeout: 5 });
  }
}
