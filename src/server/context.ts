import { withContext, type Db } from "./db";
import { forbidden } from "./errors";

export type Permission = "view" | "create" | "edit" | "export" | "sensitive";
export type Role = "admin" | "user";

/** Ko radi i u kojoj organizaciji. Nastaje isključivo iz aktivnog članstva u bazi. */
export type TenantCtx = {
  tenantId: string;
  tenantName: string;
  userId: string;
  userName: string;
  email: string;
  role: Role;
  perms: Record<Permission, boolean>;
};

export type MembershipSummary = { tenantId: string; tenantName: string; role: Role };

type MembershipRow = {
  tenant_id: string;
  tenant_name: string;
  role: Role;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_export: boolean;
  can_view_sensitive: boolean;
  first_name: string;
  last_name: string;
  email: string;
};

/**
 * Aktivna članstva korisnika u aktivnim organizacijama i kontekst za izabranu
 * (ili prvu). Tražena organizacija bez aktivnog članstva daje `ctx: null`.
 */
export async function loadTenantCtx(
  userId: string,
  tenantId?: string | null,
): Promise<{ ctx: TenantCtx | null; memberships: MembershipSummary[] }> {
  const rows = await withContext({ userId }, async (db) => {
    const r = await db.query<MembershipRow>(
      `SELECT m.tenant_id, t.name AS tenant_name, m.role, m.can_view, m.can_create, m.can_edit,
              m.can_export, m.can_view_sensitive, p.first_name, p.last_name, p.email
       FROM tenant_memberships m
       JOIN tenants t ON t.id = m.tenant_id
       JOIN profiles p ON p.user_id = m.user_id
       WHERE m.user_id = $1 AND m.status = 'active' AND t.status = 'active'
       ORDER BY t.name`,
      [userId],
    );
    return r.rows;
  });
  const memberships = rows.map((r) => ({ tenantId: r.tenant_id, tenantName: r.tenant_name, role: r.role }));
  const row = tenantId ? rows.find((r) => r.tenant_id === tenantId) : rows[0];
  if (!row) return { ctx: null, memberships };
  const admin = row.role === "admin";
  return {
    memberships,
    ctx: {
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      userId,
      userName: `${row.first_name} ${row.last_name}`.trim(),
      email: row.email,
      role: row.role,
      perms: {
        view: admin || row.can_view,
        create: admin || row.can_create,
        edit: admin || row.can_edit,
        export: admin || row.can_export,
        // Osetljivi podaci (JMBG) traže izričitu dozvolu i za administratora.
        sensitive: row.can_view_sensitive,
      },
    },
  };
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  return withContext({ userId }, async (db) => {
    const r = await db.query("SELECT 1 FROM platform_admins WHERE user_id = $1", [userId]);
    return r.rows.length > 0;
  });
}

/** Transakcija u kontekstu organizacije. */
export const tenantDb = <T>(ctx: TenantCtx, fn: (db: Db) => Promise<T>) =>
  withContext({ tenantId: ctx.tenantId, userId: ctx.userId }, fn);

const DENIED: Record<Permission, string> = {
  view: "Nemate dozvolu za pregled podataka.",
  create: "Nemate dozvolu za unos podataka.",
  edit: "Nemate dozvolu za izmenu podataka.",
  export: "Nemate dozvolu za izvoz podataka.",
  sensitive: "Nemate dozvolu za pristup osetljivim podacima.",
};

export function requirePerm(ctx: TenantCtx, permission: Permission) {
  if (!ctx.perms[permission]) throw forbidden(DENIED[permission]);
}

export function requireAdmin(ctx: TenantCtx) {
  if (ctx.role !== "admin") throw forbidden("Ova radnja je dostupna samo administratoru organizacije.");
}
