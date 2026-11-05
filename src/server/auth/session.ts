import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "~/server/auth";
import { query } from "~/server/db/database";
import { users } from "~/server/db/schema";
import { runServer } from "~/server/effect/runtime";

/** A live (not soft-deleted, not banned) user's display fields */
const liveUser = Effect.fn("session.liveUser")(function* (userId: string) {
  const user = yield* query((db) =>
    db.query.users.findFirst({
      columns: {
        id: true,
        name: true,
        email: true,
        role: true,
        locale: true,
        banned: true,
      },
      where: and(eq(users.id, userId), isNull(users.deletedAt)),
    }),
  );

  return user && !user.banned ? user : null;
});

/**
 * The signed-in user for this render, validated against the database (once per
 * request thanks to React's cache). Soft-deleted and banned users count as
 * signed out.
 */
export const getCurrentUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });

  return session ? runServer(liveUser(session.user.id)) : null;
});
