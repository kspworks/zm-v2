import { Effect } from "effect";

import { query } from "~/server/db/database";
import { historyLogs } from "~/server/db/schema";

export type AuditEntity =
  | "account"
  | "category"
  | "transaction"
  | "schedule"
  | "counterparty"
  | "user"
  | "import";

export type AuditAction = "create" | "update" | "delete" | "restore";

/**
 * Writes one history row per entity id on the current handle, so inside the
 * change's `transaction(...)` the log and the change commit or roll back
 * together.
 */
export const audit = Effect.fnUntraced(function* (entry: {
  entityType: AuditEntity;
  entityId: string | readonly string[];
  action: AuditAction;
  userId: string;
  payload: unknown;
}) {
  const ids: readonly string[] = Array.isArray(entry.entityId)
    ? entry.entityId
    : [entry.entityId as string];

  if (ids.length === 0) {
    return;
  }

  yield* query((db) =>
    db.insert(historyLogs).values(
      ids.map((entityId) => ({
        entityType: entry.entityType,
        entityId,
        action: entry.action,
        userId: entry.userId,
        payload: (entry.payload ?? {}) as object,
      })),
    ),
  );
});
