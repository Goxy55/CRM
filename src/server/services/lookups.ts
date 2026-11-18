import { tenantDb, type TenantCtx } from "../context";

export type Option = { id: string; name: string; active: boolean };

export type Lookups = {
  activities: Option[];
  productions: Option[];
  services: (Option & { category: string | null })[];
  members: Option[];
  defaultCurrency: string;
};

/** Šifarnici organizacije za formulare i filtere. */
export async function getLookups(ctx: TenantCtx): Promise<Lookups> {
  return tenantDb(ctx, async (db) => {
    const t = [ctx.tenantId];
    const activities = await db.query<Option>(
      "SELECT id, name, active FROM business_activities WHERE tenant_id = $1 ORDER BY lower(name)",
      t,
    );
    const productions = await db.query<Option>(
      "SELECT id, name, active FROM production_categories WHERE tenant_id = $1 ORDER BY sort_order, lower(name)",
      t,
    );
    const services = await db.query<Option & { category: string | null }>(
      "SELECT id, name, active, category FROM services WHERE tenant_id = $1 ORDER BY lower(name)",
      t,
    );
    const members = await db.query<Option>(
      `SELECT m.user_id AS id, p.first_name || ' ' || p.last_name AS name, m.status = 'active' AS active
       FROM tenant_memberships m JOIN profiles p ON p.user_id = m.user_id
       WHERE m.tenant_id = $1 AND m.status <> 'pending' ORDER BY lower(p.last_name), lower(p.first_name)`,
      t,
    );
    const settings = await db.query<{ default_currency: string }>(
      "SELECT default_currency FROM tenant_settings WHERE tenant_id = $1",
      t,
    );
    return {
      activities: activities.rows,
      productions: productions.rows,
      services: services.rows,
      members: members.rows,
      defaultCurrency: settings.rows[0]?.default_currency ?? "RSD",
    };
  });
}
