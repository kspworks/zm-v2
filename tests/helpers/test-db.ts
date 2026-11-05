import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import postgres from "postgres";
import { createClient } from "redis";

/**
 * The throwaway postgres (and redis) from docker-compose.test.yml, shared by
 * the Vitest global setup and the Playwright database script (e2e/setup-db.ts).
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

const canPingRedis = async (url: string): Promise<boolean> => {
  const client = createClient({
    url,
    socket: { connectTimeout: 2_000, reconnectStrategy: false },
  });
  client.on("error", () => undefined);

  try {
    await client.connect();

    return (await client.ping()) === "PONG";
  } catch {
    return false;
  } finally {
    client.destroy();
  }
};

const startContainer = async (
  service: string,
  url: string,
  reachable: (url: string) => Promise<boolean>,
): Promise<void> => {
  await exec("docker", [
    "compose",
    "-f",
    COMPOSE_FILE,
    "up",
    "-d",
    "--wait",
    service,
  ]);

  // publishing the host port can lag behind the container healthcheck
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt++) {
    if (await reachable(url)) {
      return;
    }

    await sleep(CONNECT_INTERVAL_MS);
  }

  throw new Error(`Test ${service} never became reachable at ${url}`);
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

  await startContainer("postgres-test", url, canConnect);
};

/** Starts the compose redis unless it is already reachable */
export const ensureTestRedis = async (url: string): Promise<void> => {
  if (await canPingRedis(url)) {
    return;
  }

  if (process.env.TEST_DB_AUTOSTART === "0") {
    throw new Error(`Test redis is unreachable at ${url}`);
  }

  await startContainer("redis-test", url, canPingRedis);
};
