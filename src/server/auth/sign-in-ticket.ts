import { Effect } from "effect";

import { query } from "~/server/db/database";
import { verifications } from "~/server/db/schema";
import { now } from "~/server/lib/clock";
import { randomString } from "~/server/lib/ids";
import { sha256 } from "~/server/lib/tokens";

/*
 * A short-lived, single-use ticket that lets a user who just proved password
 * and TOTP (registration, recovery) get a session without typing them again.
 * It is redeemed by the "/zm/ticket-sign-in" auth endpoint.
 */

const TICKET_TTL_MS = 10 * 60_000;

export const ticketIdentifier = (ticket: string) =>
  `zm-signin:${sha256(ticket)}`;

export const issueSignInTicket = Effect.fn("signInTicket.issue")(function* (
  userId: string,
) {
  const ticket = randomString(48);
  const at = yield* now;

  yield* query((db) =>
    db.insert(verifications).values({
      identifier: ticketIdentifier(ticket),
      value: userId,
      expiresAt: new Date(at.getTime() + TICKET_TTL_MS),
    }),
  );

  return ticket;
});
