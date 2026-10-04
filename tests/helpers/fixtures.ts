import { eq } from "drizzle-orm";

import { enrolTwoFactor, hashPassword } from "~/server/auth/two-factor";
import { db } from "~/server/db";
import {
  accountMembers,
  authAccounts,
  categoryMembers,
  transactions,
  users,
} from "~/server/db/schema";
import { generateTotpSecret } from "~/server/lib/totp";
import { insertAccount } from "~/server/services/accounts";
import { insertCategory } from "~/server/services/categories";

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

/**
 * A backup code with a letter in it, plus the same code with every letter's
 * case swapped (codes are 10 random alphanumerics, so one has a letter)
 */
export const caseSwappedBackupCode = (backupCodes: string[]) => {
  const code = backupCodes.find((candidate) => /[a-z]/i.test(candidate)) ?? "";
  const swapped = [...code]
    .map((char) =>
      char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase(),
    )
    .join("");

  return { code, swapped };
};

// ---------------------------------------------------------------------------
// accounts, categories, sharing, raw transactions
// ---------------------------------------------------------------------------

export const makeAccount = async (
  user: { id: string },
  overrides: Partial<{
    name: string;
    type: "cash" | "card" | "account" | "credit" | "deposit" | "debt";
    currencyId: string;
    initialBalance: number;
    isActive: boolean;
  }> = {},
) => {
  sequence += 1;

  return db.transaction((tx) =>
    insertAccount(tx, {
      userId: user.id,
      values: {
        name: `Account ${sequence}`,
        type: "card",
        currencyId: CURRENCY.UAH,
        initialBalance: 0,
        isActive: true,
        ...overrides,
      },
    }),
  );
};

export const makeCategory = async (
  user: { id: string },
  overrides: Partial<{
    name: string;
    parentId: string | null;
    isExpense: boolean;
    isIncome: boolean;
    seedKey: string | null;
  }> = {},
) => {
  sequence += 1;

  return db.transaction((tx) =>
    insertCategory(tx, {
      userId: user.id,
      values: {
        name: `Category ${sequence}`,
        parentId: null,
        isExpense: true,
        isIncome: false,
        ...overrides,
      },
    }),
  );
};

/** Gives `user` a member row on an account or category directly */
export const grant = async (
  entity: "account" | "category",
  id: string,
  user: { id: string },
  { canWrite = false, canRead = true } = {},
) => {
  if (entity === "account") {
    await db
      .insert(accountMembers)
      .values({ accountId: id, userId: user.id, canRead, canWrite });
  } else {
    await db
      .insert(categoryMembers)
      .values({ categoryId: id, userId: user.id, canRead, canWrite });
  }
};

/** A raw transaction row, bypassing the service rules (for read-side tests) */
export const insertTransactionRow = async (
  values: Partial<typeof transactions.$inferInsert> & {
    accountId: string;
    amount: number;
    createdBy: string;
  },
) => {
  const [row] = await db
    .insert(transactions)
    .values({
      kind: values.amount < 0 ? "expense" : "income",
      date: "2026-01-15",
      ...values,
    })
    .returning();

  if (!row) {
    throw new Error("insertTransactionRow returned no row");
  }

  return row;
};
