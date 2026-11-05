import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { Cause, Clock, Effect, Logger } from "effect";

import { cronSecret } from "~/server/config";
import { AppConfig } from "~/server/effect/app-config";
import { type AppServices, runServer } from "~/server/effect/runtime";
import { reportError } from "~/server/lib/report";
import { safeEqual } from "~/server/lib/tokens";

/**
 * Only "Authorization: Bearer <CRON_SECRET>" passes, compared in constant
 * time. Without a configured secret every request is refused: a literal
 * "Bearer undefined" must never be accepted.
 */
export const isCronAuthorized = (
  header: string | null,
  secret: string | undefined = cronSecret(),
): boolean => {
  if (!secret || !header) {
    return false;
  }

  return safeEqual(header, `Bearer ${secret}`);
};

const messageText = (message: unknown) =>
  Array.isArray(message) ? message.map(String).join(" ") : String(message);

/**
 * Runs a job with a logger that formats every `Effect.log` line as
 * "[CRON] [name] yyyy-MM-dd HH:mm:ss - text" (APP_TIMEZONE), collects the
 * lines for the response and echoes them to stdout. A failure is logged and
 * reported, and turns the status into 500.
 */
const runJob = Effect.fn("cron.runJob")(function* <E>(
  name: string,
  job: Effect.Effect<void, E, AppServices>,
) {
  const { timezone, nodeEnv } = yield* AppConfig;
  const lines: string[] = [];
  const logger = Logger.make(({ message, date }) => {
    const stamp = format(new TZDate(date, timezone), "yyyy-MM-dd HH:mm:ss");
    const line = `[CRON] [${name}] ${stamp} - ${messageText(message)}`;

    lines.push(line);

    if (nodeEnv !== "test") {
      // biome-ignore lint/suspicious/noConsole: cron jobs log to stdout
      console.log(line);
    }
  });

  const status = yield* Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    const result = yield* job.pipe(
      Effect.as(200),
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const error = Cause.squash(cause);

          yield* Effect.log(
            `failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          reportError(error, `cron:${name}`);

          return 500;
        }),
      ),
    );
    const finished = yield* Clock.currentTimeMillis;

    yield* Effect.log(`done in ${finished - started}ms`);

    return result;
  }).pipe(Effect.provide(Logger.layer([logger])));

  return { status, lines };
});

/**
 * Wraps a job as a GET route handler answering text/plain log lines plus the
 * total duration.
 */
export const cronHandler =
  <E>(name: string, job: Effect.Effect<void, E, AppServices>) =>
  async (request: Request): Promise<Response> => {
    if (!isCronAuthorized(request.headers.get("authorization"))) {
      return new Response("Unauthorized\n", {
        status: 401,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const { status, lines } = await runServer(runJob(name, job));

    return new Response(`${lines.join("\n")}\n`, {
      status,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  };
