import { z } from "zod";
import { audit } from "../audit";
import { requirePerm, tenantDb, type TenantCtx } from "../context";
import type { Db } from "../db";
import { invalid } from "../errors";
import { CLIENT_STATUSES, CLIENT_TYPES } from "@/lib/domain";
import { labels } from "@/i18n";

export const REPORT_KEYS = [
  "total",
  "byMunicipality",
  "byActivity",
  "byProduction",
  "activeClients",
  "byService",
  "newByMonth",
  "byResponsible",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_TITLES: Record<ReportKey, string> = {
  total: "Ukupan broj klijenata",
  byMunicipality: "Klijenti po opštinama",
  byActivity: "Klijenti po delatnostima",
  byProduction: "Klijenti po vrsti proizvodnje",
  activeClients: "Aktivni klijenti",
  byService: "Klijenti po vrstama usluga",
  newByMonth: "Novi klijenti po mesecima",
  byResponsible: "Klijenti po odgovornoj osobi",
};

export type ReportFilters = {
  from?: string;
  to?: string;
  status?: string;
  activityId?: string;
  responsibleUserId?: string;
};

export type ReportColumn = { key: string; label: string; numeric?: boolean };
export type ReportRow = Record<string, string | number | null>;
export type Report = {
  key: ReportKey;
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Zbirni red; kod izveštaja gde se klijent javlja u više redova nije prost zbir. */
  total?: ReportRow;
  note?: string;
  chart?: { category: string; value: string };
  filters: ReportFilters;
};

const filtersSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  status: z.enum(CLIENT_STATUSES).optional().or(z.literal("")),
  activityId: z.uuid().optional().or(z.literal("")),
  responsibleUserId: z.string().max(100).optional(),
});

/**
 * Zajednička osnova svih izveštaja. Period se odnosi na datum prvog kontakta,
 * a ako on nije unet, na datum kreiranja klijenta. Arhivirani klijenti ulaze
 * samo kada se izričito traži status „Arhiviran“.
 */
const BASE = `
  WITH scoped AS (
    SELECT c.*, coalesce(c.first_contact_date, (c.created_at AT TIME ZONE 'Europe/Belgrade')::date) AS ref_date
    FROM clients c
    WHERE c.tenant_id = $1
      AND ($4::text IS NOT NULL OR c.status <> 'archived')
      AND ($4::text IS NULL OR c.status = $4)
      AND ($5::uuid IS NULL OR c.activity_id = $5)
      AND ($6::text IS NULL OR c.responsible_user_id = $6)
      AND ($2::date IS NULL OR coalesce(c.first_contact_date, (c.created_at AT TIME ZONE 'Europe/Belgrade')::date) >= $2)
      AND ($3::date IS NULL OR coalesce(c.first_contact_date, (c.created_at AT TIME ZONE 'Europe/Belgrade')::date) <= $3)
  )`;

const count: ReportColumn = { key: "clients", label: "Broj klijenata", numeric: true };

async function grouped(db: Db, params: unknown[], labelSql: string, joins = "", order = "clients DESC, label") {
  const r = await db.query<{ label: string; clients: number }>(
    `${BASE} SELECT ${labelSql} AS label, count(DISTINCT s.id)::int AS clients
     FROM scoped s ${joins} GROUP BY 1 ORDER BY ${order}`,
    params,
  );
  return r.rows;
}

async function distinctClients(db: Db, params: unknown[], joins = ""): Promise<number> {
  const r = await db.query<{ n: number }>(`${BASE} SELECT count(DISTINCT s.id)::int AS n FROM scoped s ${joins}`, params);
  return r.rows[0].n;
}

export async function runReport(ctx: TenantCtx, key: string, rawFilters: ReportFilters = {}): Promise<Report> {
  requirePerm(ctx, "view");
  if (!REPORT_KEYS.includes(key as ReportKey)) throw invalid("Nepoznat izveštaj.");
  const parsed = filtersSchema.safeParse(rawFilters);
  if (!parsed.success) throw invalid("Neispravni filteri izveštaja.");
  const f = parsed.data;
  if (f.from && f.to && f.from > f.to) throw invalid("Početak perioda je posle kraja.");
  const reportKey = key as ReportKey;
  const status = reportKey === "activeClients" ? "active" : f.status || null;
  const params = [ctx.tenantId, f.from || null, f.to || null, status, f.activityId || null, f.responsibleUserId || null];
  const base = { key: reportKey, title: REPORT_TITLES[reportKey], filters: { ...f, status: status ?? "" } };
  const named = (label: string): ReportColumn[] => [{ key: "label", label }, count];
  const chart = { category: "label", value: "clients" };

  return tenantDb(ctx, async (db): Promise<Report> => {
    const all = await distinctClients(db, params);
    const total = { label: "Ukupno", clients: all };
    switch (reportKey) {
      case "total": {
        const rows = await grouped(db, params, "s.type", "", "clients DESC");
        return {
          ...base,
          columns: named("Tip klijenta"),
          rows: CLIENT_TYPES.map((type) => ({
            label: labels.clientType[type],
            clients: rows.find((r) => r.label === type)?.clients ?? 0,
          })),
          total,
          chart,
        };
      }
      case "byMunicipality":
        return {
          ...base,
          columns: named("Opština"),
          rows: await grouped(db, params, "coalesce(nullif(btrim(s.municipality), ''), 'Nije uneto')"),
          total,
          chart,
        };
      case "byActivity":
        return {
          ...base,
          columns: named("Delatnost"),
          rows: await grouped(db, params, "coalesce(a.name, 'Nije uneto')", "LEFT JOIN business_activities a ON a.id = s.activity_id"),
          total,
          chart,
        };
      case "byProduction": {
        const joins = "JOIN client_productions cp ON cp.client_id = s.id JOIN production_categories pc ON pc.id = cp.production_category_id";
        const withProduction = await distinctClients(db, params, "JOIN client_productions cp ON cp.client_id = s.id");
        return {
          ...base,
          columns: named("Vrsta proizvodnje"),
          rows: await grouped(db, params, "pc.name", joins),
          total: { label: "Jedinstvenih klijenata sa proizvodnjom", clients: withProduction },
          note: "Klijent sa više vrsta proizvodnje prikazan je u svakoj od njih, pa zbir redova može biti veći od broja jedinstvenih klijenata.",
          chart,
        };
      }
      case "byService": {
        const r = await db.query<ReportRow>(
          `${BASE} SELECT sv.name AS label, count(DISTINCT s.id)::int AS clients, count(k.id)::int AS collaborations
           FROM scoped s JOIN collaborations k ON k.client_id = s.id AND k.status <> 'cancelled'
           JOIN services sv ON sv.id = k.service_id GROUP BY 1 ORDER BY clients DESC, label`,
          params,
        );
        const withService = await distinctClients(db, params, "JOIN collaborations k ON k.client_id = s.id AND k.status <> 'cancelled'");
        return {
          ...base,
          columns: [...named("Usluga"), { key: "collaborations", label: "Broj saradnji", numeric: true }],
          rows: r.rows,
          total: {
            label: "Jedinstvenih klijenata sa saradnjom",
            clients: withService,
            collaborations: r.rows.reduce((sum, row) => sum + Number(row.collaborations), 0),
          },
          note: "Otkazane saradnje se ne računaju. Klijent sa više usluga prikazan je u svakoj od njih.",
          chart,
        };
      }
      case "newByMonth":
        return {
          ...base,
          columns: named("Mesec"),
          rows: await grouped(db, params, "to_char(s.ref_date, 'YYYY-MM')", "", "label"),
          total,
          note: "Mesec se određuje po datumu prvog kontakta, a ako nije unet, po datumu kreiranja klijenta.",
          chart,
        };
      case "byResponsible":
        return {
          ...base,
          columns: named("Odgovorna osoba"),
          rows: await grouped(
            db,
            params,
            "coalesce(p.first_name || ' ' || p.last_name, 'Nije dodeljeno')",
            "LEFT JOIN profiles p ON p.user_id = s.responsible_user_id",
          ),
          total,
          chart,
        };
      case "activeClients": {
        const r = await db.query<ReportRow>(
          `${BASE} SELECT s.display_name AS name, s.type, s.municipality, a.name AS activity,
                  p.first_name || ' ' || p.last_name AS responsible, s.phone, s.email
           FROM scoped s
           LEFT JOIN business_activities a ON a.id = s.activity_id
           LEFT JOIN profiles p ON p.user_id = s.responsible_user_id
           ORDER BY lower(s.display_name) LIMIT 5000`,
          params,
        );
        return {
          ...base,
          columns: [
            { key: "name", label: "Klijent" },
            { key: "type", label: "Tip" },
            { key: "municipality", label: "Opština" },
            { key: "activity", label: "Delatnost" },
            { key: "responsible", label: "Odgovorna osoba" },
            { key: "phone", label: "Telefon" },
            { key: "email", label: "Email" },
          ],
          rows: r.rows.map((row) => ({ ...row, type: labels.clientType[row.type as keyof typeof labels.clientType] })),
          total: { name: "Ukupno aktivnih klijenata", type: String(r.rows.length) },
        };
      }
    }
  });
}

/** Opis filtera za zaglavlje izvezenog izveštaja. */
export function describeFilters(f: ReportFilters): string {
  const parts: string[] = [];
  if (f.from || f.to) parts.push(`Period: ${f.from || "…"} – ${f.to || "…"}`);
  if (f.status) parts.push(`Status: ${labels.clientStatus[f.status as keyof typeof labels.clientStatus] ?? f.status}`);
  if (f.activityId) parts.push("Filter: delatnost");
  if (f.responsibleUserId) parts.push("Filter: odgovorna osoba");
  return parts.length ? parts.join(" · ") : "Bez filtera (svi klijenti osim arhiviranih)";
}

/** Izvoz izveštaja: traži dozvolu za izvoz i ostavlja trag u evidenciji. */
export async function exportReport(ctx: TenantCtx, key: string, filters: ReportFilters, format: "xlsx" | "pdf") {
  requirePerm(ctx, "export");
  const report = await runReport(ctx, key, filters);
  const meta = { tenantName: ctx.tenantName, filters: describeFilters(report.filters), generatedAt: new Date() };
  const { reportToXlsx } = await import("../exports/xlsx");
  const { reportToPdf } = await import("../exports/pdf");
  const data = format === "xlsx" ? await reportToXlsx(report, meta) : await reportToPdf(report, meta);
  await tenantDb(ctx, (db) =>
    audit(db, ctx, {
      action: "report.exported",
      entityType: "report",
      entityId: report.key,
      summary: `Izvezen izveštaj „${report.title}“ (${format.toUpperCase()})`,
      metadata: { format, rows: report.rows.length },
    }),
  );
  return { data, filename: `izvestaj-${report.key}-${meta.generatedAt.toISOString().slice(0, 10)}.${format}`, report };
}
