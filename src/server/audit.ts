import type { Db } from "./db";

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  clientId?: string | null;
  summary: string;
  /** Bez lozinki, JMBG-a i drugih osetljivih vrednosti. */
  metadata?: Record<string, unknown>;
};

/** Upis u evidenciju aktivnosti, u istoj transakciji kao i sama promena. */
export async function audit(
  db: Db,
  actor: { tenantId: string | null; userId: string | null },
  entry: AuditEntry,
) {
  await db.query(
    `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, client_id, summary, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      actor.tenantId,
      actor.userId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.clientId ?? null,
      entry.summary,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}
