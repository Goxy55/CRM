import { requireAdmin, requirePerm, tenantDb, type TenantCtx } from "../context";
import { ACTIVE_COLLABORATION_STATUSES } from "@/lib/domain";
import type { ClientListItem } from "./clients";

export type Kpis = { totalClients: number; activeClients: number; newThisMonth: number; activeCollaborations: number };

/**
 * Pokazatelji na početnoj strani:
 * - Ukupno klijenata: svi osim arhiviranih.
 * - Aktivni klijenti: status „Aktivan“.
 * - Novi ovog meseca: kreirani u tekućem kalendarskom mesecu (vreme u Srbiji), osim arhiviranih.
 * - Aktivne saradnje: status „Ugovoreno“ ili „U toku“.
 */
export async function getDashboard(ctx: TenantCtx): Promise<{ kpis: Kpis; recent: ClientListItem[] }> {
  requirePerm(ctx, "view");
  return tenantDb(ctx, async (db) => {
    const kpis = await db.query<Kpis>(
      `SELECT
         count(*) FILTER (WHERE status <> 'archived')::int AS "totalClients",
         count(*) FILTER (WHERE status = 'active')::int AS "activeClients",
         count(*) FILTER (WHERE status <> 'archived' AND created_at >=
           date_trunc('month', now() AT TIME ZONE 'Europe/Belgrade') AT TIME ZONE 'Europe/Belgrade')::int AS "newThisMonth",
         (SELECT count(*)::int FROM collaborations k WHERE k.tenant_id = $1 AND k.status = ANY($2)) AS "activeCollaborations"
       FROM clients WHERE tenant_id = $1`,
      [ctx.tenantId, ACTIVE_COLLABORATION_STATUSES],
    );
    const recent = await db.query<ClientListItem>(
      `SELECT c.id, c.type, c.display_name AS "displayName", c.status, a.name AS "activityName", c.municipality,
              c.phone, c.email, c.updated_at AS "updatedAt",
              CASE WHEN p.user_id IS NULL THEN NULL ELSE p.first_name || ' ' || p.last_name END AS "responsibleName"
       FROM clients c
       LEFT JOIN business_activities a ON a.id = c.activity_id
       LEFT JOIN profiles p ON p.user_id = c.responsible_user_id
       WHERE c.tenant_id = $1 AND c.status <> 'archived'
       ORDER BY c.updated_at DESC LIMIT 10`,
      [ctx.tenantId],
    );
    return { kpis: kpis.rows[0], recent: recent.rows };
  });
}

export type AuditRow = {
  id: string;
  createdAt: Date;
  userName: string | null;
  action: string;
  entityType: string;
  clientId: string | null;
  clientName: string | null;
  summary: string;
};

/** Istorija aktivnosti: za jednog klijenta (svi sa pravom pregleda) ili cele organizacije (administrator). */
export async function listAudit(
  ctx: TenantCtx,
  options: { clientId?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: AuditRow[]; total: number }> {
  if (options.clientId) requirePerm(ctx, "view");
  else requireAdmin(ctx);
  const pageSize = Math.min(options.pageSize ?? 50, 200);
  const offset = (Math.max(options.page ?? 1, 1) - 1) * pageSize;
  return tenantDb(ctx, async (db) => {
    const params = [ctx.tenantId, options.clientId ?? null];
    const where = "l.tenant_id = $1 AND ($2::uuid IS NULL OR l.client_id = $2)";
    const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs l WHERE ${where}`, params);
    const rows = await db.query<AuditRow>(
      `SELECT l.id, l.created_at AS "createdAt", l.action, l.entity_type AS "entityType", l.client_id AS "clientId",
              c.display_name AS "clientName", l.summary,
              CASE WHEN p.user_id IS NULL THEN NULL ELSE p.first_name || ' ' || p.last_name END AS "userName"
       FROM audit_logs l
       LEFT JOIN profiles p ON p.user_id = l.user_id
       LEFT JOIN clients c ON c.id = l.client_id
       WHERE ${where} ORDER BY l.created_at DESC, l.id LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    return { rows: rows.rows, total: total.rows[0].n };
  });
}
