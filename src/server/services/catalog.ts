import { z } from "zod";
import { audit } from "../audit";
import { requireAdmin, tenantDb, type TenantCtx } from "../context";
import { conflict, invalid, notFound, pgCode } from "../errors";
import { lookupNameSchema, serviceFormSchema } from "@/lib/schemas";

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  active: boolean;
  collaborations: number;
};

/** Katalog usluga organizacije sa brojem saradnji koje ih koriste. */
export async function listServices(ctx: TenantCtx): Promise<ServiceRow[]> {
  return tenantDb(ctx, async (db) => {
    const r = await db.query<ServiceRow>(
      `SELECT s.id, s.name, s.description, s.category, s.active,
              (SELECT count(*)::int FROM collaborations k WHERE k.service_id = s.id) AS collaborations
       FROM services s WHERE s.tenant_id = $1 ORDER BY s.active DESC, lower(s.name)`,
      [ctx.tenantId],
    );
    return r.rows;
  });
}

function parseService(raw: unknown) {
  const parsed = serviceFormSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Proverite označena polja.", z.flattenError(parsed.error).fieldErrors);
  return { name: parsed.data.name, description: parsed.data.description || null, category: parsed.data.category || null };
}

const duplicateName = (e: unknown, what: string): never => {
  if (pgCode(e) === "23505") throw conflict(`${what} sa tim nazivom već postoji.`);
  throw e;
};

export async function createService(ctx: TenantCtx, raw: unknown): Promise<{ id: string }> {
  requireAdmin(ctx);
  const input = parseService(raw);
  return tenantDb(ctx, async (db) => {
    try {
      const r = await db.query<{ id: string }>(
        "INSERT INTO services (tenant_id, name, description, category) VALUES ($1, $2, $3, $4) RETURNING id",
        [ctx.tenantId, input.name, input.description, input.category],
      );
      await audit(db, ctx, {
        action: "service.created",
        entityType: "service",
        entityId: r.rows[0].id,
        summary: `Dodata usluga „${input.name}“`,
      });
      return r.rows[0];
    } catch (e) {
      return duplicateName(e, "Usluga");
    }
  });
}

export async function updateService(ctx: TenantCtx, id: string, raw: unknown) {
  requireAdmin(ctx);
  const input = parseService(raw);
  await tenantDb(ctx, async (db) => {
    try {
      const r = await db.query(
        "UPDATE services SET name = $3, description = $4, category = $5 WHERE id = $1 AND tenant_id = $2",
        [id, ctx.tenantId, input.name, input.description, input.category],
      );
      if (!r.rowCount) throw notFound("Usluga nije pronađena.");
    } catch (e) {
      duplicateName(e, "Usluga");
    }
    await audit(db, ctx, {
      action: "service.updated",
      entityType: "service",
      entityId: id,
      summary: `Izmenjena usluga „${input.name}“`,
    });
  });
}

/**
 * Usluge se ne brišu: deaktivirana usluga ostaje na postojećim saradnjama,
 * ali se ne može izabrati za nove.
 */
export async function setServiceActive(ctx: TenantCtx, id: string, active: boolean) {
  requireAdmin(ctx);
  await tenantDb(ctx, async (db) => {
    const r = await db.query<{ name: string }>(
      "UPDATE services SET active = $3 WHERE id = $1 AND tenant_id = $2 RETURNING name",
      [id, ctx.tenantId, active],
    );
    if (!r.rows[0]) throw notFound("Usluga nije pronađena.");
    await audit(db, ctx, {
      action: active ? "service.activated" : "service.deactivated",
      entityType: "service",
      entityId: id,
      summary: `${active ? "Aktivirana" : "Deaktivirana"} usluga „${r.rows[0].name}“`,
    });
  });
}

/** Podesivi šifarnici: delatnosti i vrste poljoprivredne proizvodnje. */
const LOOKUPS = {
  activity: { table: "business_activities", label: "Delatnost", entity: "business_activity" },
  production: { table: "production_categories", label: "Vrsta proizvodnje", entity: "production_category" },
} as const;
export type LookupKind = keyof typeof LOOKUPS;

export async function createLookup(ctx: TenantCtx, kind: LookupKind, raw: unknown): Promise<{ id: string }> {
  requireAdmin(ctx);
  const parsed = lookupNameSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Unesite naziv.");
  const def = LOOKUPS[kind];
  return tenantDb(ctx, async (db) => {
    try {
      const r = await db.query<{ id: string }>(
        `INSERT INTO ${def.table} (tenant_id, name) VALUES ($1, $2) RETURNING id`,
        [ctx.tenantId, parsed.data.name],
      );
      await audit(db, ctx, {
        action: "lookup.created",
        entityType: def.entity,
        entityId: r.rows[0].id,
        summary: `${def.label}: dodato „${parsed.data.name}“`,
      });
      return r.rows[0];
    } catch (e) {
      return duplicateName(e, def.label);
    }
  });
}

export async function updateLookup(
  ctx: TenantCtx,
  kind: LookupKind,
  id: string,
  change: { name?: string; active?: boolean },
) {
  requireAdmin(ctx);
  const def = LOOKUPS[kind];
  const name = change.name === undefined ? undefined : lookupNameSchema.safeParse({ name: change.name });
  if (name && !name.success) throw invalid("Unesite naziv.");
  await tenantDb(ctx, async (db) => {
    try {
      const r = await db.query<{ name: string }>(
        `UPDATE ${def.table} SET name = coalesce($3, name), active = coalesce($4, active)
         WHERE id = $1 AND tenant_id = $2 RETURNING name`,
        [id, ctx.tenantId, name?.data?.name ?? null, change.active ?? null],
      );
      if (!r.rows[0]) throw notFound("Stavka nije pronađena.");
      await audit(db, ctx, {
        action: "lookup.updated",
        entityType: def.entity,
        entityId: id,
        summary: `${def.label}: izmenjeno „${r.rows[0].name}“${change.active === undefined ? "" : change.active ? " (aktivirano)" : " (deaktivirano)"}`,
      });
    } catch (e) {
      duplicateName(e, def.label);
    }
  });
}
