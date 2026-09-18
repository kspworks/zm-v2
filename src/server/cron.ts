import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

import { appTimezone, cronSecret } from "~/server/config";
import { now } from "~/server/lib/clock";
import { reportError } from "~/server/lib/report";
import { safeEqual } from "~/server/lib/tokens";

export type CronLog = (text: string) => void;

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

/**
 * Wraps a job as a GET route handler answering text/plain log lines like
 * "[CRON] [name] yyyy-MM-dd HH:mm:ss - text", plus the total duration.
 */
export const cronHandler =
  (name: string, job: (log: CronLog) => Promise<void>) =>
  async (request: Request): Promise<Response> => {
    if (!isCronAuthorized(request.headers.get("authorization"))) {
      return new Response("Unauthorized\n", {
        status: 401,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const lines: string[] = [];
    const log: CronLog = (text) => {
      const stamp = format(
        new TZDate(now(), appTimezone()),
        "yyyy-MM-dd HH:mm:ss",
      );
      const line = `[CRON] [${name}] ${stamp} - ${text}`;

      lines.push(line);

      if (process.env.NODE_ENV !== "test") {
        // biome-ignore lint/suspicious/noConsole: cron jobs log to stdout
        console.log(line);
      }
    };

    const started = Date.now();
    let status = 200;

    try {
      await job(log);
    } catch (error) {
      status = 500;
      log(`failed: ${error instanceof Error ? error.message : String(error)}`);
      reportError(error, `cron:${name}`);
    }

    log(`done in ${Date.now() - started}ms`);

    return new Response(`${lines.join("\n")}\n`, {
      status,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  };
