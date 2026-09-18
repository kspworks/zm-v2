"use client";

import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [twoFactorClient(), adminClient()],
});

/** Redeems a single-use ticket issued by registration or recovery */
export const signInWithTicket = (ticket: string) =>
  authClient.$fetch<{ ok: boolean }>("/zm/ticket-sign-in", {
    method: "POST",
    body: { ticket },
  });
