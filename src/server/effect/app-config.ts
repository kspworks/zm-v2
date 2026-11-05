import { Context, Layer } from "effect";

import {
  appTimezone,
  authBaseUrl,
  buildId,
  cronSecret,
  isDev,
  type MailConfig,
  mailConfig,
  paginationLimit,
  redisUrl,
} from "~/server/config";

/**
 * Server configuration for Effect code. Built once per runtime from the
 * `~/server/config` accessors, which stay the single source of truth for the
 * non-Effect edges (better-auth options, server components).
 */
export class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly timezone: string;
    readonly paginationLimit: number;
    readonly cronSecret: string | undefined;
    readonly authBaseUrl: string;
    readonly mail: MailConfig | null;
    readonly redisUrl: string | undefined;
    readonly isDev: boolean;
    readonly nodeEnv: string | undefined;
    readonly buildId: string | undefined;
  }
>()("zm/server/effect/AppConfig") {
  static readonly fromEnv = () =>
    AppConfig.of({
      timezone: appTimezone(),
      paginationLimit: paginationLimit(),
      cronSecret: cronSecret(),
      authBaseUrl: authBaseUrl(),
      mail: mailConfig(),
      redisUrl: redisUrl(),
      isDev: isDev(),
      nodeEnv: process.env.NODE_ENV,
      buildId: buildId(),
    });

  static readonly layer = Layer.sync(AppConfig, AppConfig.fromEnv);

  /** The env-built config with some values replaced, for tests */
  static readonly layerWith = (overrides: Partial<AppConfig["Service"]>) =>
    Layer.sync(AppConfig, () =>
      AppConfig.of({ ...AppConfig.fromEnv(), ...overrides }),
    );
}
