import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";
import superjson from "superjson";

export const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        retry: (failureCount, error) => {
          const code = (error as { data?: { code?: string } }).data?.code;

          // business-rule and auth failures won't change on retry
          if (code && code !== "INTERNAL_SERVER_ERROR") {
            return false;
          }

          return failureCount < 2;
        },
      },
      dehydrate: {
        serializeData: superjson.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: { deserializeData: superjson.deserialize },
    },
  });
