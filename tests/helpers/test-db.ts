import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import postgres from "postgres";

/**
 * The throwaway postgres from docker-compose.test.yml, shared by the Vitest
 * global setup and the Playwright database script (e2e/setup-db.ts).
 */

const exec = promisify(execFile);

const COMPOSE_FILE = "docker-compose.test.yml";
const CONNECT_ATTEMPTS = 30;
const CONNECT_INTERVAL_MS = 500;

export const canConnect = async (url: string): Promise<boolean> => {
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

/** Starts the compose container unless the server is already reachable */
export const ensureTestDatabase = async (url: string): Promise<void> => {
  if (await canConnect(url)) {
    return;
  }

  // CI provides postgres as a service, so it opts out of the docker dance
  if (process.env.TEST_DB_AUTOSTART === "0") {
    throw new Error(`Test database is unreachable at ${url}`);
  }

  await startContainer(url);
};
