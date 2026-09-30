import type * as Sentry from "@sentry/nextjs";

// "DataCollection" is not re-exported by "@sentry/nextjs", so take it off "init"
type SentryDataCollection = NonNullable<
  NonNullable<Parameters<typeof Sentry.init>[0]>["dataCollection"]
>;

// "CollectBehavior" (headers, cookies, query params) is not re-exported either
type SentryCollectBehavior = NonNullable<
  SentryDataCollection["urlQueryParams"]
>;

const SENTRY_DENIED_KEYS: SentryCollectBehavior = {
  deny: ["forwarded", "-ip", "remote-", "via", "-user"],
};

/**
 * Shared by "sentry.server.config.ts", "sentry.edge.config.ts" and
 * "instrumentation-client.ts" so the three can't drift. This app's events are
 * about money: no client IP, no user identifiers, no request bodies. v11
 * replaced "sendDefaultPii" with "dataCollection", and an *unset*
 * "dataCollection" collects all of that by default - so the v10 restrictive
 * baseline is spelled out here, category by category.
 */
export const SENTRY_DATA_COLLECTION: SentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: SENTRY_DENIED_KEYS, response: SENTRY_DENIED_KEYS },
  httpBodies: [],
  urlQueryParams: SENTRY_DENIED_KEYS,
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
};
