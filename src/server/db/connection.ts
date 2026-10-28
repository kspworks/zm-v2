import { env } from "~/env";

/**
 * Shared by the app's pool ("./index.ts") and both migration paths
 * ("~/server/migrate-on-boot", "scripts/migrate.ts"), so all of them reach the
 * database the same way.
 *
 * "path" is how postgres-js connects over a Unix socket: it takes the host
 * from the URL's hostname and ignores libpq's "?host=/var/run/postgresql".
 * With "path" set, the URL's host and port are not used.
 */
export const connectionOptions = () => {
  // with SKIP_ENV_VALIDATION an empty string is not stripped
  const socket = env.DATABASE_SOCKET_PATH?.trim();

  return {
    onnotice: () => false,
    ...(socket ? { path: socket } : {}),
  };
};
