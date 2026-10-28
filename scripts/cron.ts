/**
 * Calls the cron routes at their wall-clock time in APP_TIMEZONE, for the
 * Docker deploys (Vercel runs "vercel.json" itself).
 *
 * Runs as its own container next to the app (see "compose.vps.yml") and holds
 * nothing but CRON_SECRET: it reaches the app over the compose network with
 * the bearer header "~/server/cron" checks. Bundled into "build/cron.mjs" by
 * "pnpm build:scripts".
 */
import { calendarDateIn } from "~/lib/dates";

import { CRON_JOBS, type CronJob, dueJobs } from "./cron-schedule";

const { CRON_SECRET, CRON_BASE_URL } = process.env;
const timeZone = process.env.APP_TIMEZONE || "Europe/Kyiv";

// the handlers can take a while; this only stops a hung request from holding
// the next run back forever
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

// a network error means the request never reached a handler - typically the
// app container being swapped by a deploy - so it is safe to try again. An
// HTTP error is not retried: the handler may already have done part of its work
const NETWORK_RETRIES = 3;
const NETWORK_RETRY_DELAY_MS = 30 * 1000;

const log = (path: string, text: string) => {
  // biome-ignore lint/suspicious/noConsole: system logs
  console.log(`[CRON] [${path}] ${new Date().toISOString()} - ${text}`);
};

const logError = (path: string, text: string) => {
  // biome-ignore lint/suspicious/noConsole: system logs
  console.error(`[CRON] [${path}] ${new Date().toISOString()} - ${text}`);
};

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const trigger = async ({ path }: CronJob) => {
  for (let attempt = 1; attempt <= NETWORK_RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${CRON_BASE_URL}${path}`, {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.text()).trim();

      if (response.ok) {
        log(path, `${response.status}\n${body}`);
      } else {
        logError(path, `${response.status}\n${body}`);
      }

      return;
    } catch (error) {
      logError(path, `attempt ${attempt}/${NETWORK_RETRIES} failed: ${error}`);

      if (attempt < NETWORK_RETRIES) {
        await sleep(NETWORK_RETRY_DELAY_MS);
      }
    }
  }
};

const lastRun = new Map<string, string>();

const tick = () => {
  const now = new Date();

  for (const job of dueJobs(now, timeZone, lastRun)) {
    lastRun.set(job.path, calendarDateIn(now, timeZone));
    void trigger(job);
  }

  // a second into the next minute, so a timer that fires a little early still
  // lands inside it; scheduling from "now" each time means no drift
  setTimeout(tick, 60_000 - (Date.now() % 60_000) + 1000);
};

if (!CRON_SECRET || !CRON_BASE_URL) {
  // biome-ignore lint/suspicious/noConsole: system logs
  console.error("CRON_SECRET and CRON_BASE_URL must both be set");
  process.exit(1);
}

try {
  // throws on a zone Intl doesn't know, instead of never firing
  new Intl.DateTimeFormat("en", { timeZone });
} catch {
  // biome-ignore lint/suspicious/noConsole: system logs
  console.error(`APP_TIMEZONE "${timeZone}" is not a known time zone`);
  process.exit(1);
}

for (const job of CRON_JOBS) {
  log(job.path, `runs daily at ${job.at} ${timeZone}`);
}

tick();
