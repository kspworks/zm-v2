/**
 * Calls the cron routes at their wall-clock time in APP_TIMEZONE, for the
 * Docker deploys (Vercel runs "vercel.json" itself).
 *
 * Runs as its own container next to the app (see "compose.vps.yml") and holds
 * nothing but CRON_SECRET: it reaches the app over the compose network with
 * the bearer header "~/server/cron" checks. Bundled into "build/cron.mjs" by
 * "pnpm build:scripts".
 */
import { NodeRuntime } from "@effect/platform-node";
import { Clock, Config, Effect, Schedule, Schema } from "effect";

import { calendarDateIn } from "~/lib/dates";

import { CRON_JOBS, type CronJob, dueJobs } from "./cron-schedule";

// the handlers can take a while; this only stops a hung request from holding
// the next run back forever
const REQUEST_TIMEOUT = "5 minutes";

// a network error means the request never reached a handler - typically the
// app container being swapped by a deploy - so it is safe to try again. An
// HTTP error is not retried: the handler may already have done part of its work
const NETWORK_RETRIES = 3;
const NETWORK_RETRY_DELAY = "30 seconds";

class StartupError extends Schema.TaggedError<StartupError>()("StartupError", {
  message: Schema.String,
}) {}

const line = (path: string, text: string) =>
  Effect.map(
    Clock.currentTimeMillis,
    (millis) => `[CRON] [${path}] ${new Date(millis).toISOString()} - ${text}`,
  );

const print = (stream: "log" | "error", text: string) =>
  Effect.sync(() => {
    // biome-ignore lint/suspicious/noConsole: system logs
    console[stream](text);
  });

const log = (path: string, text: string) =>
  Effect.flatMap(line(path, text), (out) => print("log", out));

const logError = (path: string, text: string) =>
  Effect.flatMap(line(path, text), (out) => print("error", out));

const settings = Effect.gen(function* () {
  const secret = yield* Config.String("CRON_SECRET").pipe(
    Config.withDefault(""),
  );
  const baseUrl = yield* Config.String("CRON_BASE_URL").pipe(
    Config.withDefault(""),
  );
  const timeZone =
    (yield* Config.String("APP_TIMEZONE").pipe(Config.withDefault(""))) ||
    "Europe/Kyiv";

  if (!secret || !baseUrl) {
    return yield* new StartupError({
      message: "CRON_SECRET and CRON_BASE_URL must both be set",
    });
  }

  // throws on a zone Intl doesn't know, instead of never firing
  yield* Effect.try({
    try: () => new Intl.DateTimeFormat("en", { timeZone }),
    catch: () =>
      new StartupError({
        message: `APP_TIMEZONE "${timeZone}" is not a known time zone`,
      }),
  });

  return { secret, baseUrl, timeZone };
});

const trigger = (
  { path }: CronJob,
  { secret, baseUrl }: { secret: string; baseUrl: string },
) => {
  let attempt = 0;

  return Effect.tryPromise((signal) =>
    fetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${secret}` },
      signal,
    }).then(async (response) => ({
      ok: response.ok,
      status: response.status,
      body: (await response.text()).trim(),
    })),
  ).pipe(
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.tapError((error) => {
      attempt += 1;

      return logError(
        path,
        `attempt ${attempt}/${NETWORK_RETRIES} failed: ${error}`,
      );
    }),
    Effect.retry(
      Schedule.spaced(NETWORK_RETRY_DELAY).pipe(
        Schedule.upTo({ times: NETWORK_RETRIES - 1 }),
      ),
    ),
    Effect.flatMap(({ ok, status, body }) =>
      ok
        ? log(path, `${status}\n${body}`)
        : logError(path, `${status}\n${body}`),
    ),
    Effect.ignore,
  );
};

const program = Effect.gen(function* () {
  const config = yield* settings;
  // the local day each job last ran on; a restart forgets it, which is fine
  // because only the exact minute ever fires (see dueJobs)
  const lastRun = new Map<string, string>();

  for (const job of CRON_JOBS) {
    yield* log(job.path, `runs daily at ${job.at} ${config.timeZone}`);
  }

  const tick = Effect.gen(function* () {
    const now = new Date(yield* Clock.currentTimeMillis);

    for (const job of dueJobs(now, config.timeZone, lastRun)) {
      lastRun.set(job.path, calendarDateIn(now, config.timeZone));
      yield* Effect.forkDetach(trigger(job, config));
    }

    // a second into the next minute, so a timer that fires a little early
    // still lands inside it; sleeping from "now" each time means no drift
    yield* Effect.sleep(60_000 - (now.getTime() % 60_000) + 1000);
  });

  return yield* Effect.forever(tick);
}).pipe(Effect.tapError((error) => print("error", error.message)));

// SIGTERM from Docker interrupts the loop; a startup error exits with 1
NodeRuntime.runMain(program, { disableErrorReporting: true });
