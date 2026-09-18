import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";

/**
 * The signed-in user for this render, validated against the database (once per
 * request thanks to React's cache). Soft-deleted and banned users count as
 * signed out.
 */
export const getCurrentUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return null;
  }

  const user = await db.query.users.findFirst({
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      locale: true,
      banned: true,
    },
    where: and(eq(users.id, session.user.id), isNull(users.deletedAt)),
  });

  return user && !user.banned ? user : null;
});
