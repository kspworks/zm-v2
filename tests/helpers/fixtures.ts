import { eq } from "drizzle-orm";

import { enrolTwoFactor, hashPassword } from "~/server/auth/two-factor";
import { db } from "~/server/db";
import { authAccounts, currencies, users } from "~/server/db/schema";
import { generateTotpSecret } from "~/server/lib/totp";

let sequence = 0;

export const CURRENCY = {
  UAH: "smea6nsp8t6nrofg7gul2ai6",
  USD: "toegx59plx5s345ddc8kilps",
  EUR: "p7pwusz57z3ndrzbkr2uvdgm",
  GBP: "mby0x01v764is0rwfrfjegil",
} as const;

export type TestUser = typeof users.$inferSelect;

export const createUser = async (
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<TestUser> => {
  sequence += 1;

  const [user] = await db
    .insert(users)
    .values({
      name: `User ${sequence}`,
      email: `user${sequence}@example.com`,
      role: "user",
      locale: "en",
      ...overrides,
    })
    .returning();

  if (!user) {
    throw new Error("createUser returned no row");
  }

  return user;
};

export const createAdmin = (
  overrides: Partial<typeof users.$inferInsert> = {},
) => createUser({ role: "admin", ...overrides });

/** A user who can sign in: password credential plus an enrolled authenticator */
export const createUserWithCredentials = async (
  overrides: Partial<typeof users.$inferInsert> = {},
  password = "secret123",
) => {
  const user = await createUser(overrides);
  const secret = generateTotpSecret();

  await db.insert(authAccounts).values({
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await hashPassword(password),
  });

  const backupCodes = await db.transaction((tx) =>
    enrolTwoFactor(tx, user.id, secret),
  );

  const [fresh] = await db.select().from(users).where(eq(users.id, user.id));

  return { user: fresh ?? user, password, secret, backupCodes };
};

export const allCurrencies = () =>
  db.select().from(currencies).orderBy(currencies.code);
