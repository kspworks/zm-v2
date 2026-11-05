import type { DbOrTx } from "~/server/db";
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
 * Writes one history row. Always pass the transaction handle of the change it
 * describes, so the log and the change commit or roll back together.
 */
export const audit = async (
  tx: DbOrTx,
  entry: {
    entityType: AuditEntity;
    entityId: string | string[];
    action: AuditAction;
    userId: string;
    payload: unknown;
  },
): Promise<void> => {
  const ids = Array.isArray(entry.entityId) ? entry.entityId : [entry.entityId];

  if (ids.length === 0) {
    return;
  }

  await tx.insert(historyLogs).values(
    ids.map((entityId) => ({
      entityType: entry.entityType,
      entityId,
      action: entry.action,
      userId: entry.userId,
      payload: (entry.payload ?? {}) as object,
    })),
  );
};
