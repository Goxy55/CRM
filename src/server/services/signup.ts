import { z } from "zod";
import { audit } from "../audit";
import { createUserWithPassword, findUserIdByEmail, isLockedOut, recordLoginAttempt, verifyUserPassword } from "../auth";
import { requireAdmin, tenantDb, type TenantCtx } from "../context";
import { randomToken } from "../crypto";
import { withContext } from "../db";
import { env } from "../env";
import { conflict, invalid, notFound, pgCode } from "../errors";
import { sendMail } from "../mail";
import { accessGrantSchema, signupFormSchema } from "@/lib/schemas";
import { labels } from "@/i18n";

/**
 * Samostalna prijava korisnika: osoba sa linkom organizacije pravi nalog i
 * zahtev za pristup; administrator organizacije zahtev odobrava (uz ulogu i
 * dozvole) ili odbija. Do odobrenja nalog nema pristup nijednom podatku.
 */

/** Najviše novih zahteva po organizaciji u jednom satu, i ukupno na čekanju. */
const MAX_REQUESTS_PER_HOUR = 30;
const MAX_PENDING = 200;

const linkFor = (token: string) => `${env().appUrl}/registracija/${token}`;

export async function getSignupLink(ctx: TenantCtx): Promise<string | null> {
  requireAdmin(ctx);
  return tenantDb(ctx, async (db) => {
    const r = await db.query<{ signup_token: string | null }>(
      "SELECT signup_token FROM tenant_settings WHERE tenant_id = $1",
      [ctx.tenantId],
    );
    const token = r.rows[0]?.signup_token;
    return token ? linkFor(token) : null;
  });
}

/**
 * Uključuje link (novi, ako ne postoji), pravi novi link (stari prestaje da
 * važi) ili ga isključuje.
 */
export async function setSignupLink(ctx: TenantCtx, mode: "enable" | "regenerate" | "disable"): Promise<string | null> {
  requireAdmin(ctx);
  return tenantDb(ctx, async (db) => {
    const current = await db.query<{ signup_token: string | null }>(
      "SELECT signup_token FROM tenant_settings WHERE tenant_id = $1 FOR UPDATE",
      [ctx.tenantId],
    );
    const existing = current.rows[0]?.signup_token ?? null;
    const token = mode === "disable" ? null : mode === "enable" && existing ? existing : randomToken();
    if (token === existing) return token ? linkFor(token) : null;
    await db.query("UPDATE tenant_settings SET signup_token = $2 WHERE tenant_id = $1", [ctx.tenantId, token]);
    await audit(db, ctx, {
      action: `signup_link.${mode === "disable" ? "disabled" : existing ? "regenerated" : "enabled"}`,
      entityType: "tenant",
      entityId: ctx.tenantId,
      summary:
        mode === "disable"
          ? "Isključen link za prijavu korisnika"
          : existing
            ? "Napravljen novi link za prijavu korisnika (prethodni više ne važi)"
            : "Uključen link za prijavu korisnika",
    });
    return token ? linkFor(token) : null;
  });
}

const validToken = (token: string) => /^[A-Za-z0-9_-]{20,100}$/.test(token);

/** Naziv organizacije za važeći link aktivne organizacije, inače null. */
export async function getSignupTenant(token: string): Promise<{ tenantId: string; tenantName: string } | null> {
  if (!validToken(token)) return null;
  return withContext({ signupToken: token }, async (db) => {
    const r = await db.query<{ tenantId: string; tenantName: string }>(
      `SELECT t.id AS "tenantId", t.name AS "tenantName"
       FROM tenant_settings s JOIN tenants t ON t.id = s.tenant_id
       WHERE s.signup_token = $1 AND t.status = 'active'`,
      [token],
    );
    return r.rows[0] ?? null;
  });
}

const INVALID_LINK = "Link za prijavu nije važeći. Zatražite novi od administratora organizacije.";
const BAD_PASSWORD = "Prijava nije uspela. Ako već imate nalog sa ovom email adresom, unesite njegovu postojeću lozinku.";

/** Zahtev za pristup preko linka organizacije. Organizacija se određuje isključivo iz linka. */
export async function requestAccess(token: string, raw: unknown): Promise<{ tenantName: string }> {
  const parsed = signupFormSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Proverite označena polja.", z.flattenError(parsed.error).fieldErrors);
  const input = { ...parsed.data, email: parsed.data.email.toLowerCase() };
  const tenant = await getSignupTenant(token);
  if (!tenant) throw invalid(INVALID_LINK);

  const load = await withContext({ tenantId: tenant.tenantId, signupToken: token }, (db) =>
    db.query<{ recent: number; pending: number }>(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS recent, count(*)::int AS pending
       FROM tenant_memberships WHERE tenant_id = $1 AND status = 'pending'`,
      [tenant.tenantId],
    ),
  );
  if (load.rows[0].recent >= MAX_REQUESTS_PER_HOUR || load.rows[0].pending >= MAX_PENDING)
    throw invalid("Trenutno nije moguće primiti nove zahteve. Pokušajte kasnije.");

  // Postojeći nalog (npr. član druge organizacije) dokazuje vlasništvo lozinkom,
  // uz isto zaključavanje kao pri prijavi.
  let userId = await findUserIdByEmail(input.email);
  if (userId) {
    if (await isLockedOut(input.email)) throw invalid("Previše neuspelih pokušaja. Pokušajte ponovo za 15 minuta.");
    const ok = await verifyUserPassword(userId, input.password);
    await recordLoginAttempt(input.email, ok);
    if (!ok) throw invalid(BAD_PASSWORD);
  } else {
    try {
      userId = await createUserWithPassword({
        email: input.email,
        name: `${input.firstName} ${input.lastName}`,
        password: input.password,
      });
    } catch (e) {
      if (pgCode(e) === "23505") throw invalid(BAD_PASSWORD);
      throw e;
    }
  }

  await withContext({ tenantId: tenant.tenantId, userId, signupToken: token }, async (db) => {
    const existing = await db.query<{ status: string }>(
      "SELECT status FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2",
      [tenant.tenantId, userId],
    );
    const status = existing.rows[0]?.status;
    if (status === "active") throw conflict("Već imate pristup ovoj organizaciji. Prijavite se.");
    if (status === "pending") throw conflict("Vaš zahtev već čeka odobrenje administratora.");
    if (status === "inactive") throw invalid("Vaš pristup ovoj organizaciji je isključen. Obratite se administratoru.");
    await db.query(
      `INSERT INTO profiles (user_id, first_name, last_name, email) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, input.firstName, input.lastName, input.email],
    );
    await db.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role, status, can_view, can_create, can_edit, can_export, can_view_sensitive)
       VALUES ($1, $2, 'user', 'pending', false, false, false, false, false)`,
      [tenant.tenantId, userId],
    );
    await audit(db, { tenantId: tenant.tenantId, userId }, {
      action: "member.requested",
      entityType: "membership",
      entityId: userId,
      summary: `Zahtev za pristup: ${input.firstName} ${input.lastName}`,
    });
  });

  await notifyAdmins(tenant, `${input.firstName} ${input.lastName}`);
  return { tenantName: tenant.tenantName };
}

/** Obaveštenje aktivnim administratorima; neuspeh slanja ne poništava zahtev. */
async function notifyAdmins(tenant: { tenantId: string; tenantName: string }, name: string) {
  try {
    const admins = await withContext({ tenantId: tenant.tenantId }, (db) =>
      db.query<{ email: string }>(
        `SELECT p.email FROM tenant_memberships m JOIN profiles p ON p.user_id = m.user_id
         WHERE m.tenant_id = $1 AND m.role = 'admin' AND m.status = 'active'`,
        [tenant.tenantId],
      ),
    );
    for (const { email } of admins.rows)
      await sendMail({
        to: email,
        subject: `CRM — novi zahtev za pristup (${tenant.tenantName})`,
        text: `${name} je zatražio/la pristup organizaciji „${tenant.tenantName}“.\n\nZahtev pregledajte i odobrite ili odbijte u Administracija → Korisnici:\n${env().appUrl}/administracija`,
      });
  } catch (e) {
    console.error("Obaveštenje o zahtevu za pristup nije poslato:", (e as Error).message);
  }
}

export type AccessRequest = { userId: string; firstName: string; lastName: string; email: string; requestedAt: Date };

export async function listAccessRequests(ctx: TenantCtx): Promise<AccessRequest[]> {
  requireAdmin(ctx);
  return tenantDb(ctx, async (db) => {
    const r = await db.query<AccessRequest>(
      `SELECT m.user_id AS "userId", p.first_name AS "firstName", p.last_name AS "lastName", p.email,
              m.created_at AS "requestedAt"
       FROM tenant_memberships m JOIN profiles p ON p.user_id = m.user_id
       WHERE m.tenant_id = $1 AND m.status = 'pending' ORDER BY m.created_at`,
      [ctx.tenantId],
    );
    return r.rows;
  });
}

/** Broj zahteva na čekanju (za obaveštenje administratoru); ostalima 0. */
export async function countAccessRequests(ctx: TenantCtx): Promise<number> {
  if (ctx.role !== "admin") return 0;
  return tenantDb(ctx, async (db) => {
    const r = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM tenant_memberships WHERE tenant_id = $1 AND status = 'pending'",
      [ctx.tenantId],
    );
    return r.rows[0].n;
  });
}

const PERMISSION_KEYS = ["canView", "canCreate", "canEdit", "canExport", "canViewSensitive"] as const;

export async function approveAccessRequest(ctx: TenantCtx, userId: string, raw: unknown) {
  requireAdmin(ctx);
  const parsed = accessGrantSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Neispravni podaci o ulozi i dozvolama.");
  const g = parsed.data;
  await tenantDb(ctx, async (db) => {
    const r = await db.query<{ name: string }>(
      `UPDATE tenant_memberships m SET status = 'active', role = $3, can_view = $4, can_create = $5, can_edit = $6,
         can_export = $7, can_view_sensitive = $8
       FROM profiles p
       WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.status = 'pending' AND p.user_id = m.user_id
       RETURNING p.first_name || ' ' || p.last_name AS name`,
      [ctx.tenantId, userId, g.role, g.canView, g.canCreate, g.canEdit, g.canExport, g.canViewSensitive],
    );
    if (!r.rows[0]) throw notFound("Zahtev nije pronađen ili je već obrađen.");
    const granted = PERMISSION_KEYS.filter((k) => (g.role === "admin" && k !== "canViewSensitive") || g[k]).map(
      (k) => labels.permission[k],
    );
    await audit(db, ctx, {
      action: "member.approved",
      entityType: "membership",
      entityId: userId,
      summary: `Odobren pristup: ${r.rows[0].name} (${labels.role[g.role]}; ${granted.join(", ") || "bez dozvola"})`,
      metadata: { role: g.role, ...Object.fromEntries(PERMISSION_KEYS.map((k) => [k, g[k]])) },
    });
  });
}

/** Odbijen zahtev se uklanja; nalog ostaje, ali bez pristupa ovoj organizaciji. */
export async function rejectAccessRequest(ctx: TenantCtx, userId: string) {
  requireAdmin(ctx);
  await tenantDb(ctx, async (db) => {
    const profile = await db.query<{ name: string }>(
      `SELECT p.first_name || ' ' || p.last_name AS name FROM tenant_memberships m JOIN profiles p ON p.user_id = m.user_id
       WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.status = 'pending'`,
      [ctx.tenantId, userId],
    );
    if (!profile.rows[0]) throw notFound("Zahtev nije pronađen ili je već obrađen.");
    await db.query("DELETE FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2 AND status = 'pending'", [
      ctx.tenantId,
      userId,
    ]);
    await audit(db, ctx, {
      action: "member.rejected",
      entityType: "membership",
      entityId: userId,
      summary: `Odbijen zahtev za pristup: ${profile.rows[0].name}`,
    });
  });
}

/** Organizacije u kojima korisnik čeka odobrenje (za stranu „Nema pristupa“). */
export async function pendingOrganizations(userId: string): Promise<string[]> {
  return withContext({ userId }, async (db) => {
    const r = await db.query<{ name: string }>(
      `SELECT t.name FROM tenant_memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = $1 AND m.status = 'pending' AND t.status = 'active' ORDER BY t.name`,
      [userId],
    );
    return r.rows.map((x) => x.name);
  });
}
