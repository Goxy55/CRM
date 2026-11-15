import { z } from "zod";
import { audit } from "../audit";
import { isPlatformAdmin, requireAdmin, tenantDb, type TenantCtx } from "../context";
import { setContext, withContext, type Db } from "../db";
import { DEFAULT_ACTIVITIES, DEFAULT_PRODUCTIONS } from "../defaults";
import { forbidden, invalid, notFound } from "../errors";
import { createInvitation, type InviteResult } from "./users";

export type TenantRow = {
  id: string;
  name: string;
  status: "active" | "inactive";
  createdAt: Date;
  users: number;
  admins: string | null;
  pendingInvitations: number;
};

async function platformDb<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  if (!(await isPlatformAdmin(userId))) throw forbidden("Ova radnja je dostupna samo administratoru platforme.");
  return withContext({ userId, platform: true }, fn);
}

/**
 * Pregled organizacija za administratora platforme: naziv, status i nalozi.
 * Klijenti, saradnje i ostali poslovni podaci organizacija ovde nisu dostupni.
 */
export async function listTenants(userId: string): Promise<TenantRow[]> {
  return platformDb(userId, async (db) => {
    const r = await db.query<TenantRow>(
      `SELECT t.id, t.name, t.status, t.created_at AS "createdAt",
              (SELECT count(*)::int FROM tenant_memberships m WHERE m.tenant_id = t.id AND m.status = 'active') AS users,
              (SELECT string_agg(p.email, ', ' ORDER BY p.email) FROM tenant_memberships m
                 JOIN profiles p ON p.user_id = m.user_id
                 WHERE m.tenant_id = t.id AND m.role = 'admin' AND m.status = 'active') AS admins,
              (SELECT count(*)::int FROM invitations i WHERE i.tenant_id = t.id AND i.accepted_at IS NULL
                 AND i.revoked_at IS NULL AND i.expires_at > now()) AS "pendingInvitations"
       FROM tenants t ORDER BY lower(t.name)`,
    );
    return r.rows;
  });
}

export const tenantFormSchema = z.object({
  name: z.string().trim().min(2, "Unesite naziv organizacije.").max(120),
  adminEmail: z.email("Neispravna email adresa.").max(200),
  adminFirstName: z.string().trim().min(1, "Unesite ime.").max(80),
  adminLastName: z.string().trim().min(1, "Unesite prezime.").max(80),
});

const adminInvite = (v: { adminEmail: string; adminFirstName: string; adminLastName: string }) => ({
  email: v.adminEmail,
  firstName: v.adminFirstName,
  lastName: v.adminLastName,
  role: "admin" as const,
  canView: true,
  canCreate: true,
  canEdit: true,
  canExport: true,
  canViewSensitive: false,
});

/** Nova organizacija: podešavanja, početni šifarnici i pozivnica za njenog administratora. */
export async function createTenant(userId: string, raw: unknown): Promise<{ id: string; invitation: InviteResult }> {
  const parsed = tenantFormSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Proverite označena polja.", z.flattenError(parsed.error).fieldErrors);
  const input = parsed.data;
  return platformDb(userId, async (db) => {
    const r = await db.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [input.name]);
    const id = r.rows[0].id;
    // Početni podaci nove organizacije upisuju se u njenom kontekstu.
    await setContext(db, { tenantId: id, userId, platform: true });
    await db.query("INSERT INTO tenant_settings (tenant_id) VALUES ($1)", [id]);
    for (const name of DEFAULT_ACTIVITIES)
      await db.query("INSERT INTO business_activities (tenant_id, name) VALUES ($1, $2)", [id, name]);
    for (const [i, name] of DEFAULT_PRODUCTIONS.entries())
      await db.query("INSERT INTO production_categories (tenant_id, name, sort_order) VALUES ($1, $2, $3)", [id, name, i]);
    const invitation = await createInvitation(db, { id, name: input.name }, userId, adminInvite(input));
    await setContext(db, { userId, platform: true });
    await audit(db, { tenantId: null, userId }, {
      action: "tenant.created",
      entityType: "tenant",
      entityId: id,
      summary: `Kreirana organizacija „${input.name}“`,
    });
    return { id, invitation };
  });
}

export async function setTenantStatus(userId: string, tenantId: string, status: "active" | "inactive") {
  await platformDb(userId, async (db) => {
    const r = await db.query<{ name: string }>("UPDATE tenants SET status = $2 WHERE id = $1 RETURNING name", [tenantId, status]);
    if (!r.rows[0]) throw notFound("Organizacija nije pronađena.");
    await audit(db, { tenantId: null, userId }, {
      action: status === "active" ? "tenant.activated" : "tenant.deactivated",
      entityType: "tenant",
      entityId: tenantId,
      summary: `${status === "active" ? "Aktivirana" : "Deaktivirana"} organizacija „${r.rows[0].name}“`,
    });
  });
}

/** Nova pozivnica za administratora postojeće organizacije (npr. kada prva istekne). */
export async function inviteTenantAdmin(userId: string, tenantId: string, raw: unknown): Promise<InviteResult> {
  const parsed = tenantFormSchema.omit({ name: true }).safeParse(raw);
  if (!parsed.success) throw invalid("Proverite označena polja.", z.flattenError(parsed.error).fieldErrors);
  return platformDb(userId, async (db) => {
    const tenant = await db.query<{ name: string }>("SELECT name FROM tenants WHERE id = $1", [tenantId]);
    if (!tenant.rows[0]) throw notFound("Organizacija nije pronađena.");
    const invitation = await createInvitation(db, { id: tenantId, name: tenant.rows[0].name }, userId, adminInvite(parsed.data));
    await audit(db, { tenantId: null, userId }, {
      action: "tenant.admin_invited",
      entityType: "tenant",
      entityId: tenantId,
      summary: `Poslata pozivnica administratoru organizacije „${tenant.rows[0].name}“`,
    });
    return invitation;
  });
}

export type Organization = { name: string; defaultCurrency: string; hasLogo: boolean };

export async function getOrganization(ctx: TenantCtx): Promise<Organization> {
  return tenantDb(ctx, async (db) => {
    const r = await db.query<Organization>(
      `SELECT t.name, s.default_currency AS "defaultCurrency", s.logo_data IS NOT NULL AS "hasLogo"
       FROM tenants t JOIN tenant_settings s ON s.tenant_id = t.id WHERE t.id = $1`,
      [ctx.tenantId],
    );
    return r.rows[0];
  });
}

const organizationSchema = z.object({
  name: z.string().trim().min(2, "Unesite naziv organizacije.").max(120),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/, "Valuta je troslovna oznaka."),
});

export async function updateOrganization(ctx: TenantCtx, raw: unknown) {
  requireAdmin(ctx);
  const parsed = organizationSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Proverite označena polja.", z.flattenError(parsed.error).fieldErrors);
  await tenantDb(ctx, async (db) => {
    await db.query("UPDATE tenants SET name = $2 WHERE id = $1", [ctx.tenantId, parsed.data.name]);
    await db.query("UPDATE tenant_settings SET default_currency = $2 WHERE tenant_id = $1", [ctx.tenantId, parsed.data.defaultCurrency]);
    await audit(db, ctx, { action: "tenant.settings_updated", entityType: "tenant", entityId: ctx.tenantId, summary: "Izmenjena podešavanja organizacije" });
  });
}

const LOGO_MAX_BYTES = 256 * 1024;

/** Tip slike se utvrđuje iz sadržaja, ne iz naziva ili zaglavlja. SVG nije dozvoljen. */
function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

export async function setLogo(ctx: TenantCtx, bytes: Buffer | null) {
  requireAdmin(ctx);
  const mime = bytes ? imageMime(bytes) : null;
  if (bytes && !mime) throw invalid("Logo mora biti PNG, JPEG ili WebP slika.");
  if (bytes && bytes.length > LOGO_MAX_BYTES) throw invalid("Logo može imati najviše 256 KB.");
  await tenantDb(ctx, async (db) => {
    await db.query("UPDATE tenant_settings SET logo_mime = $2, logo_data = $3 WHERE tenant_id = $1", [ctx.tenantId, mime, bytes]);
    await audit(db, ctx, {
      action: "tenant.logo_changed",
      entityType: "tenant",
      entityId: ctx.tenantId,
      summary: bytes ? "Postavljen logo organizacije" : "Uklonjen logo organizacije",
    });
  });
}

export async function getLogo(ctx: TenantCtx): Promise<{ mime: string; data: Buffer } | null> {
  return tenantDb(ctx, async (db) => {
    const r = await db.query<{ mime: string | null; data: Buffer | null }>(
      "SELECT logo_mime AS mime, logo_data AS data FROM tenant_settings WHERE tenant_id = $1",
      [ctx.tenantId],
    );
    const row = r.rows[0];
    return row?.mime && row.data ? { mime: row.mime, data: row.data } : null;
  });
}
