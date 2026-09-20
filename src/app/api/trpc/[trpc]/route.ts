import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { reportError } from "~/server/lib/report";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
    onError: ({ path, error }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        reportError(error, `trpc:${path ?? "<no-path>"}`);
      }
    },
  });

/**
 * A CSV import writes the whole file in one transaction and is by far the
 * longest call here; serverless hosts read this from the build output.
 */
export const maxDuration = 60;

export { handler as GET, handler as POST };
