import { z } from "zod";
import { audit } from "../audit";
import { createUserWithPassword, findUserIdByEmail } from "../auth";
import { requireAdmin, tenantDb, type TenantCtx } from "../context";
import { randomToken, tokenHash } from "../crypto";
import { setContext, withContext, type Db } from "../db";
import { env } from "../env";
import { conflict, invalid, notFound } from "../errors";
import { sendMail } from "../mail";
import { inviteFormSchema, memberUpdateSchema, passwordSchema, type InviteInput } from "@/lib/schemas";
import { labels } from "@/i18n";

const INVITE_DAYS = 7;

export type Member = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "admin" | "user";
  status: "active" | "inactive";
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canExport: boolean;
  canViewSensitive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
};

export type PendingInvitation = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "admin" | "user";
  expiresAt: Date;
  expired: boolean;
};

export async function listMembers(ctx: TenantCtx): Promise<Member[]> {
  requireAdmin(ctx);
  return tenantDb(ctx, async (db) => {
    const r = await db.query<Member>(
      `SELECT m.user_id AS "userId", p.first_name AS "firstName", p.last_name AS "lastName", p.email, m.role, m.status,
              m.can_view AS "canView", m.can_create AS "canCreate", m.can_edit AS "canEdit", m.can_export AS "canExport",
              m.can_view_sensitive AS "canViewSensitive", m.created_at AS "createdAt", p.last_login_at AS "lastLoginAt"
       FROM tenant_memberships m JOIN profiles p ON p.user_id = m.user_id
       WHERE m.tenant_id = $1 ORDER BY m.status, lower(p.last_name), lower(p.first_name)`,
      [ctx.tenantId],
    );
    return r.rows;
  });
}

export async function listInvitations(ctx: TenantCtx): Promise<PendingInvitation[]> {
  requireAdmin(ctx);
  return tenantDb(ctx, async (db) => {
    const r = await db.query<PendingInvitation>(
      `SELECT id, email, first_name AS "firstName", last_name AS "lastName", role, expires_at AS "expiresAt",
              expires_at < now() AS expired
       FROM invitations WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [ctx.tenantId],
    );
    return r.rows;
  });
}

export type InviteResult = { id: string; link: string; mailed: boolean };

/** Upis pozivnice i slanje poruke. Token se čuva samo kao otisak. */
export async function createInvitation(
  db: Db,
  tenant: { id: string; name: string },
  createdBy: string,
  input: InviteInput,
): Promise<InviteResult> {
  const token = randomToken();
  const email = input.email.toLowerCase();
  await db.query(
    "UPDATE invitations SET revoked_at = now() WHERE tenant_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL",
    [tenant.id, email],
  );
  const r = await db.query<{ id: string }>(
    `INSERT INTO invitations (tenant_id, email, first_name, last_name, role, can_view, can_create, can_edit, can_export,
                              can_view_sensitive, token_hash, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + make_interval(days => $12), $13) RETURNING id`,
    [
      tenant.id, email, input.firstName, input.lastName, input.role, input.canView, input.canCreate, input.canEdit,
      input.canExport, input.canViewSensitive, tokenHash(token), INVITE_DAYS, createdBy,
    ],
  );
  const link = `${env().appUrl}/pozivnica/${token}`;
  let mailed = true;
  try {
    await sendMail({
      to: email,
      subject: `Pozivnica za CRM — ${tenant.name}`,
      text: `Poštovani ${input.firstName},\n\npozvani ste da koristite CRM organizacije „${tenant.name}“.\n\nNalog aktivirate na sledećoj adresi (važi ${INVITE_DAYS} dana):\n${link}`,
    });
  } catch (e) {
    console.error("Slanje pozivnice nije uspelo:", (e as Error).message);
    mailed = false;
  }
  return { id: r.rows[0].id, link, mailed };
}

export async function inviteUser(ctx: TenantCtx, raw: unknown): Promise<InviteResult> {
  requireAdmin(ctx);
  const parsed = inviteFormSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Proverite označena polja.", z.flattenError(parsed.error).fieldErrors);
  const input = parsed.data;
  return tenantDb(ctx, async (db) => {
    const member = await db.query(
      `SELECT 1 FROM tenant_memberships m JOIN profiles p ON p.user_id = m.user_id
       WHERE m.tenant_id = $1 AND lower(p.email) = $2`,
      [ctx.tenantId, input.email.toLowerCase()],
    );
    if (member.rows.length) throw conflict("Korisnik sa ovom email adresom je već član organizacije.");
    const result = await createInvitation(db, { id: ctx.tenantId, name: ctx.tenantName }, ctx.userId, input);
    await audit(db, ctx, {
      action: "member.invited",
      entityType: "invitation",
      entityId: result.id,
      summary: `Poslata pozivnica: ${input.firstName} ${input.lastName} (${labels.role[input.role]})`,
      metadata: { role: input.role },
    });
    return result;
  });
}

export async function revokeInvitation(ctx: TenantCtx, id: string) {
  requireAdmin(ctx);
  await tenantDb(ctx, async (db) => {
    const r = await db.query(
      "UPDATE invitations SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL",
      [id, ctx.tenantId],
    );
    if (!r.rowCount) throw notFound("Pozivnica nije pronađena.");
    await audit(db, ctx, { action: "member.invitation_revoked", entityType: "invitation", entityId: id, summary: "Povučena pozivnica" });
  });
}

const PERMISSION_KEYS = ["canView", "canCreate", "canEdit", "canExport", "canViewSensitive"] as const;

/** Promena uloge, statusa i dozvola člana. Organizacija ne sme ostati bez aktivnog administratora. */
export async function updateMember(ctx: TenantCtx, userId: string, raw: unknown) {
  requireAdmin(ctx);
  const parsed = memberUpdateSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Neispravni podaci o dozvolama.");
  const next = parsed.data;
  await tenantDb(ctx, async (db) => {
    const rows = await db.query<Member>(
      `SELECT m.user_id AS "userId", m.role, m.status, m.can_view AS "canView", m.can_create AS "canCreate",
              m.can_edit AS "canEdit", m.can_export AS "canExport", m.can_view_sensitive AS "canViewSensitive",
              p.first_name AS "firstName", p.last_name AS "lastName"
       FROM tenant_memberships m JOIN profiles p ON p.user_id = m.user_id
       WHERE m.tenant_id = $1 FOR UPDATE OF m`,
      [ctx.tenantId],
    );
    const before = rows.rows.find((m) => m.userId === userId);
    if (!before) throw notFound("Korisnik nije član ove organizacije.");
    const wasActiveAdmin = before.role === "admin" && before.status === "active";
    const staysActiveAdmin = next.role === "admin" && next.status === "active";
    const otherAdmins = rows.rows.filter((m) => m.userId !== userId && m.role === "admin" && m.status === "active");
    if (wasActiveAdmin && !staysActiveAdmin && otherAdmins.length === 0)
      throw invalid("Organizacija mora imati bar jednog aktivnog administratora.");
    await db.query(
      `UPDATE tenant_memberships SET role=$3, status=$4, can_view=$5, can_create=$6, can_edit=$7, can_export=$8,
         can_view_sensitive=$9 WHERE tenant_id=$1 AND user_id=$2`,
      [ctx.tenantId, userId, next.role, next.status, next.canView, next.canCreate, next.canEdit, next.canExport, next.canViewSensitive],
    );
    const name = `${before.firstName} ${before.lastName}`;
    const changes: string[] = [];
    if (before.role !== next.role) changes.push(`uloga: ${labels.role[next.role]}`);
    for (const key of PERMISSION_KEYS)
      if (before[key] !== next[key]) changes.push(`${labels.permission[key]}: ${next[key] ? "da" : "ne"}`);
    if (changes.length)
      await audit(db, ctx, {
        action: "member.permissions_changed",
        entityType: "membership",
        entityId: userId,
        summary: `Promenjena ovlašćenja korisnika ${name} — ${changes.join("; ")}`,
        metadata: { role: next.role, ...Object.fromEntries(PERMISSION_KEYS.map((k) => [k, next[k]])) },
      });
    if (before.status !== next.status)
      await audit(db, ctx, {
        action: next.status === "active" ? "member.activated" : "member.deactivated",
        entityType: "membership",
        entityId: userId,
        summary: `${next.status === "active" ? "Aktiviran" : "Deaktiviran"} korisnik ${name}`,
      });
  });
}

type InvitationRow = {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: "admin" | "user";
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_export: boolean;
  can_view_sensitive: boolean;
  usable: boolean;
};

async function loadInvitation(db: Db, hash: string) {
  const r = await db.query<InvitationRow>(
    `SELECT *, (accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS usable
     FROM invitations WHERE token_hash = $1`,
    [hash],
  );
  const invitation = r.rows[0];
  if (!invitation?.usable) return null;
  // Od ovog trenutka transakcija radi u kontekstu organizacije iz pozivnice.
  await setContext(db, { tenantId: invitation.tenant_id, inviteHash: hash });
  const tenant = await db.query<{ name: string }>("SELECT name FROM tenants WHERE id = $1 AND status = 'active'", [
    invitation.tenant_id,
  ]);
  if (!tenant.rows[0]) return null;
  return { invitation, tenantName: tenant.rows[0].name };
}

/** Podaci za stranicu pozivnice. Nevažeći, iskorišćen ili istekao token daje null. */
export async function getInvitation(token: string) {
  const hash = tokenHash(token);
  const found = await withContext({ inviteHash: hash }, (db) => loadInvitation(db, hash));
  if (!found) return null;
  return {
    email: found.invitation.email,
    firstName: found.invitation.first_name,
    tenantName: found.tenantName,
    hasAccount: !!(await findUserIdByEmail(found.invitation.email)),
  };
}

/**
 * Prihvatanje pozivnice: novi korisnik postavlja lozinku; postojeći nalog samo
 * dobija članstvo u organizaciji (lozinka mu se ne menja).
 */
export async function acceptInvitation(token: string, password?: string): Promise<{ email: string }> {
  const hash = tokenHash(token);
  const preview = await withContext({ inviteHash: hash }, (db) => loadInvitation(db, hash));
  if (!preview) throw invalid("Pozivnica nije važeća ili je istekla. Zatražite novu od administratora.");
  const inv = preview.invitation;
  let userId = await findUserIdByEmail(inv.email);
  if (!userId) {
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) throw invalid(parsed.error.issues[0].message);
    userId = await createUserWithPassword({
      email: inv.email,
      name: `${inv.first_name} ${inv.last_name}`,
      password: parsed.data,
    });
  }
  await withContext({ inviteHash: hash }, async (db) => {
    const current = await loadInvitation(db, hash);
    if (!current) throw invalid("Pozivnica nije važeća ili je istekla. Zatražite novu od administratora.");
    await setContext(db, { tenantId: inv.tenant_id, userId, inviteHash: hash });
    await db.query(
      `INSERT INTO profiles (user_id, first_name, last_name, email) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, inv.first_name, inv.last_name, inv.email],
    );
    await db.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role, can_view, can_create, can_edit, can_export, can_view_sensitive)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET status = 'active', role = EXCLUDED.role,
         can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create, can_edit = EXCLUDED.can_edit,
         can_export = EXCLUDED.can_export, can_view_sensitive = EXCLUDED.can_view_sensitive`,
      [inv.tenant_id, userId, inv.role, inv.can_view, inv.can_create, inv.can_edit, inv.can_export, inv.can_view_sensitive],
    );
    await db.query("UPDATE invitations SET accepted_at = now() WHERE id = $1", [inv.id]);
    await audit(db, { tenantId: inv.tenant_id, userId }, {
      action: "member.joined",
      entityType: "membership",
      entityId: userId,
      summary: `${inv.first_name} ${inv.last_name} je prihvatio/la pozivnicu (${labels.role[inv.role]})`,
    });
  });
  return { email: inv.email };
}
