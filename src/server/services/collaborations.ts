import { z } from "zod";
import { audit } from "../audit";
import { requirePerm, tenantDb, type TenantCtx } from "../context";
import { invalid, notFound, pgCode } from "../errors";
import type { CollaborationStatus } from "@/lib/domain";
import { collaborationFormSchema, normalizeCollaboration, type CollaborationInput } from "@/lib/schemas";
import { labels } from "@/i18n";

export type Collaboration = {
  id: string;
  clientId: string;
  clientName: string;
  serviceId: string;
  serviceName: string;
  title: string;
  description: string | null;
  startDate: string | null;
  plannedEndDate: string | null;
  status: CollaborationStatus;
  /** Tačan decimalni zapis iz baze (numeric), npr. "125000.00". */
  contractValue: string | null;
  currency: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const SELECT = `
  SELECT k.id, k.client_id AS "clientId", c.display_name AS "clientName", k.service_id AS "serviceId",
         s.name AS "serviceName", k.title, k.description, k.start_date AS "startDate",
         k.planned_end_date AS "plannedEndDate", k.status, k.contract_value::text AS "contractValue",
         k.currency, k.responsible_user_id AS "responsibleUserId",
         CASE WHEN p.user_id IS NULL THEN NULL ELSE p.first_name || ' ' || p.last_name END AS "responsibleName",
         k.note, k.created_at AS "createdAt", k.updated_at AS "updatedAt"
  FROM collaborations k
  JOIN clients c ON c.id = k.client_id
  JOIN services s ON s.id = k.service_id
  LEFT JOIN profiles p ON p.user_id = k.responsible_user_id`;

export type CollaborationFilters = {
  clientId?: string;
  status?: string;
  serviceId?: string;
  responsibleUserId?: string;
  q?: string;
};

export async function listCollaborations(ctx: TenantCtx, filters: CollaborationFilters = {}): Promise<Collaboration[]> {
  requirePerm(ctx, "view");
  const params: unknown[] = [ctx.tenantId];
  const where = ["k.tenant_id = $1"];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replaceAll("?", `$${params.length}`));
  };
  const uuid = (v?: string) => !!v && z.uuid().safeParse(v).success;
  if (filters.clientId) {
    if (!uuid(filters.clientId)) return [];
    add("k.client_id = ?", filters.clientId);
  }
  if (filters.status) add("k.status = ?", filters.status);
  if (uuid(filters.serviceId)) add("k.service_id = ?", filters.serviceId);
  if (filters.responsibleUserId) add("k.responsible_user_id = ?", filters.responsibleUserId);
  if (filters.q?.trim())
    add("(k.title ILIKE ? OR c.display_name ILIKE ?)", `%${filters.q.trim().replace(/[\\%_]/g, "\\$&")}%`);
  return tenantDb(ctx, async (db) => {
    const r = await db.query<Collaboration>(
      `${SELECT} WHERE ${where.join(" AND ")} ORDER BY k.updated_at DESC LIMIT 500`,
      params,
    );
    return r.rows;
  });
}

export async function getCollaboration(ctx: TenantCtx, id: string): Promise<Collaboration> {
  requirePerm(ctx, "view");
  if (!z.uuid().safeParse(id).success) throw notFound("Saradnja nije pronađena.");
  return tenantDb(ctx, async (db) => {
    const r = await db.query<Collaboration>(`${SELECT} WHERE k.id = $1 AND k.tenant_id = $2`, [id, ctx.tenantId]);
    if (!r.rows[0]) throw notFound("Saradnja nije pronađena.");
    return r.rows[0];
  });
}

function parse(raw: unknown): CollaborationInput {
  const parsed = collaborationFormSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Proverite označena polja.", z.flattenError(parsed.error).fieldErrors);
  return normalizeCollaboration(parsed.data);
}

const fkError = (e: unknown): never => {
  if (pgCode(e) === "23503") throw invalid("Izabrani klijent, usluga ili osoba ne postoje u vašoj organizaciji.");
  throw e;
};

export async function createCollaboration(ctx: TenantCtx, raw: unknown): Promise<{ id: string }> {
  requirePerm(ctx, "create");
  const input = parse(raw);
  return tenantDb(ctx, async (db) => {
    const service = await db.query<{ active: boolean }>("SELECT active FROM services WHERE id = $1 AND tenant_id = $2", [
      input.serviceId,
      ctx.tenantId,
    ]);
    if (!service.rows[0]) throw invalid("Izabrana usluga ne postoji u vašoj organizaciji.");
    if (!service.rows[0].active) throw invalid("Izabrana usluga je deaktivirana.");
    try {
      const r = await db.query<{ id: string }>(
        `INSERT INTO collaborations (tenant_id, client_id, service_id, title, description, start_date, planned_end_date,
                                     status, contract_value, currency, responsible_user_id, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [
          ctx.tenantId, input.clientId, input.serviceId, input.title, input.description, input.startDate,
          input.plannedEndDate, input.status, input.contractValue, input.currency, input.responsibleUserId,
          input.note, ctx.userId,
        ],
      );
      const id = r.rows[0].id;
      // Klijent se pojavljuje među poslednjim izmenama na početnoj strani.
      await db.query("UPDATE clients SET updated_at = now() WHERE id = $1 AND tenant_id = $2", [input.clientId, ctx.tenantId]);
      await audit(db, ctx, {
        action: "collaboration.created",
        entityType: "collaboration",
        entityId: id,
        clientId: input.clientId,
        summary: `Kreirana saradnja „${input.title}“`,
        metadata: { status: input.status, serviceId: input.serviceId },
      });
      return { id };
    } catch (e) {
      return fkError(e);
    }
  });
}

const TRACKED: [keyof CollaborationInput, string][] = [
  ["serviceId", "usluga"], ["title", "naziv"], ["description", "opis"], ["startDate", "datum početka"],
  ["plannedEndDate", "planirani završetak"], ["contractValue", "ugovorena vrednost"], ["currency", "valuta"],
  ["responsibleUserId", "odgovorna osoba"], ["note", "napomena"],
];

export async function updateCollaboration(ctx: TenantCtx, id: string, raw: unknown): Promise<{ id: string }> {
  requirePerm(ctx, "edit");
  const input = parse(raw);
  const before = await getCollaboration(ctx, id);
  if (input.clientId !== before.clientId) throw invalid("Saradnja se ne može prebaciti na drugog klijenta.");
  return tenantDb(ctx, async (db) => {
    try {
      await db.query(
        `UPDATE collaborations SET service_id=$3, title=$4, description=$5, start_date=$6, planned_end_date=$7,
           status=$8, contract_value=$9, currency=$10, responsible_user_id=$11, note=$12
         WHERE id=$1 AND tenant_id=$2`,
        [
          id, ctx.tenantId, input.serviceId, input.title, input.description, input.startDate, input.plannedEndDate,
          input.status, input.contractValue, input.currency, input.responsibleUserId, input.note,
        ],
      );
    } catch (e) {
      fkError(e);
    }
    await db.query("UPDATE clients SET updated_at = now() WHERE id = $1 AND tenant_id = $2", [before.clientId, ctx.tenantId]);
    const old = before as unknown as Record<string, unknown>;
    const same = (key: keyof CollaborationInput) =>
      key === "contractValue"
        ? Number(old[key] ?? NaN) === Number(input[key] ?? NaN) || (old[key] == null && input[key] == null)
        : (old[key] ?? null) === (input[key] ?? null);
    const changed = TRACKED.filter(([key]) => !same(key)).map(([, label]) => label);
    const base = { entityType: "collaboration", entityId: id, clientId: before.clientId };
    if (changed.length)
      await audit(db, ctx, {
        ...base,
        action: "collaboration.updated",
        summary: `Izmenjena saradnja „${input.title}“: ${changed.join(", ")}`,
        metadata: { fields: changed },
      });
    if (before.status !== input.status)
      await audit(db, ctx, {
        ...base,
        action: "collaboration.status_changed",
        summary: `Status saradnje „${input.title}“: ${labels.collaborationStatus[before.status]} → ${labels.collaborationStatus[input.status]}`,
        metadata: { from: before.status, to: input.status },
      });
    return { id };
  });
}

export async function setCollaborationStatus(ctx: TenantCtx, id: string, status: CollaborationStatus) {
  requirePerm(ctx, "edit");
  const before = await getCollaboration(ctx, id);
  if (before.status === status) return;
  await tenantDb(ctx, async (db) => {
    await db.query("UPDATE collaborations SET status = $3 WHERE id = $1 AND tenant_id = $2", [id, ctx.tenantId, status]);
    await db.query("UPDATE clients SET updated_at = now() WHERE id = $1 AND tenant_id = $2", [before.clientId, ctx.tenantId]);
    await audit(db, ctx, {
      action: "collaboration.status_changed",
      entityType: "collaboration",
      entityId: id,
      clientId: before.clientId,
      summary: `Status saradnje „${before.title}“: ${labels.collaborationStatus[before.status]} → ${labels.collaborationStatus[status]}`,
      metadata: { from: before.status, to: status },
    });
  });
}
