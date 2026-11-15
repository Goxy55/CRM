import { z } from "zod";
import { audit } from "../audit";
import { requirePerm, tenantDb, type TenantCtx } from "../context";
import { decryptJmbg, encryptJmbg, jmbgHash } from "../crypto";
import type { Db } from "../db";
import { conflict, invalid, notFound, pgCode } from "../errors";
import { type ClientStatus, type ClientType, isValidJmbg } from "@/lib/domain";
import { clientFormSchema, normalizeClient, type ClientInput } from "@/lib/schemas";
import { labels } from "@/i18n";

export type DuplicateMatch = {
  field: "registrationNumber" | "taxNumber" | "bpg" | "jmbg" | "email" | "phone";
  /** Jedinstveni identifikator: čuvanje nije dozvoljeno. Email/telefon: samo upozorenje. */
  blocking: boolean;
  clientId: string;
  displayName: string;
};

export type ClientListItem = {
  id: string;
  type: ClientType;
  displayName: string;
  status: ClientStatus;
  activityName: string | null;
  municipality: string | null;
  phone: string | null;
  email: string | null;
  responsibleName: string | null;
  updatedAt: Date;
};

export type ClientDetail = ClientListItem & {
  activityId: string | null;
  responsibleUserId: string | null;
  linkedPersonId: string | null;
  linkedPersonName: string | null;
  address: string | null;
  city: string | null;
  firstContactDate: string | null;
  note: string | null;
  createdAt: Date;
  firstName: string | null;
  lastName: string | null;
  hasJmbg: boolean;
  companyName: string | null;
  registrationNumber: string | null;
  taxNumber: string | null;
  bpg: string | null;
  productions: { id: string; name: string; isPrimary: boolean }[];
  linkedClients: { id: string; displayName: string; type: ClientType }[];
};

const LIST_SELECT = `
  SELECT c.id, c.type, c.display_name AS "displayName", c.status, a.name AS "activityName",
         c.municipality, c.phone, c.email, c.updated_at AS "updatedAt",
         CASE WHEN rp.user_id IS NULL THEN NULL ELSE rp.first_name || ' ' || rp.last_name END AS "responsibleName"
  FROM clients c
  LEFT JOIN business_activities a ON a.id = c.activity_id
  LEFT JOIN profiles rp ON rp.user_id = c.responsible_user_id`;

const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, "\\$&")}%`;

export type ClientFilters = {
  q?: string;
  type?: string;
  status?: string;
  activityId?: string;
  productionId?: string;
  municipality?: string;
  responsibleUserId?: string;
  /** Tačan JMBG; samo za korisnike sa dozvolom za osetljive podatke. */
  jmbg?: string;
  includeArchived?: boolean;
  page?: number;
  pageSize?: number;
};

/**
 * Lista i pretraga klijenata. Svaka reč upita mora se naći u bar jednom od
 * polja: naziv, ime/prezime, MB, PIB, BPG, telefon, email, mesto, opština,
 * delatnost ili vrsta proizvodnje. Filteri se kombinuju (AND).
 */
export async function listClients(
  ctx: TenantCtx,
  filters: ClientFilters = {},
): Promise<{ rows: ClientListItem[]; total: number; page: number; pageSize: number }> {
  requirePerm(ctx, "view");
  const params: unknown[] = [ctx.tenantId];
  const where = ["c.tenant_id = $1"];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replaceAll("?", `$${params.length}`));
  };
  const isUuid = (v?: string) => !!v && z.uuid().safeParse(v).success;
  for (const term of (filters.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
    const digits = term.replace(/\D/g, "");
    params.push(likePattern(term), digits.length >= 3 ? `%${digits}%` : null);
    const p = `$${params.length - 1}`;
    const d = `$${params.length}`;
    where.push(`(
      c.display_name ILIKE ${p} OR c.email ILIKE ${p} OR c.phone ILIKE ${p} OR c.city ILIKE ${p}
      OR c.municipality ILIKE ${p} OR (${d}::text IS NOT NULL AND c.phone_digits LIKE ${d})
      OR a.name ILIKE ${p}
      OR EXISTS (SELECT 1 FROM client_person_details pd WHERE pd.client_id = c.id
                 AND (pd.first_name ILIKE ${p} OR pd.last_name ILIKE ${p}))
      OR EXISTS (SELECT 1 FROM client_business_details bd WHERE bd.client_id = c.id
                 AND (bd.company_name ILIKE ${p} OR bd.registration_number LIKE ${p} OR bd.tax_number LIKE ${p}))
      OR EXISTS (SELECT 1 FROM agricultural_holdings h WHERE h.client_id = c.id AND h.bpg LIKE ${p})
      OR EXISTS (SELECT 1 FROM client_productions cp JOIN production_categories pc ON pc.id = cp.production_category_id
                 WHERE cp.client_id = c.id AND pc.name ILIKE ${p})
    )`);
  }
  if (filters.type) add("c.type = ?", filters.type);
  if (filters.status) add("c.status = ?", filters.status);
  else if (!filters.includeArchived) where.push("c.status <> 'archived'");
  if (isUuid(filters.activityId)) add("c.activity_id = ?", filters.activityId);
  if (filters.municipality) add("c.municipality ILIKE ?", likePattern(filters.municipality));
  if (filters.responsibleUserId) add("c.responsible_user_id = ?", filters.responsibleUserId);
  if (isUuid(filters.productionId))
    add(
      "EXISTS (SELECT 1 FROM client_productions cp WHERE cp.client_id = c.id AND cp.production_category_id = ?)",
      filters.productionId,
    );
  const jmbg = filters.jmbg?.trim();
  if (jmbg) {
    requirePerm(ctx, "sensitive");
    if (!isValidJmbg(jmbg)) throw invalid("JMBG nije ispravan.");
    add(
      "EXISTS (SELECT 1 FROM client_person_details pd WHERE pd.client_id = c.id AND pd.jmbg_hash = ?)",
      jmbgHash(ctx.tenantId, jmbg),
    );
  }
  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
  const page = Math.max(filters.page ?? 1, 1);
  return tenantDb(ctx, async (db) => {
    const cond = where.join(" AND ");
    const total = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM clients c LEFT JOIN business_activities a ON a.id = c.activity_id WHERE ${cond}`,
      params,
    );
    const rows = await db.query<ClientListItem>(
      `${LIST_SELECT} WHERE ${cond} ORDER BY lower(c.display_name), c.id
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params,
    );
    if (jmbg)
      await audit(db, ctx, {
        action: "client.jmbg_searched",
        entityType: "client",
        summary: "Pretraga klijenata po JMBG-u",
        metadata: { results: total.rows[0].n },
      });
    return { rows: rows.rows, total: total.rows[0].n, page, pageSize };
  });
}

export async function getClient(ctx: TenantCtx, id: string): Promise<ClientDetail> {
  requirePerm(ctx, "view");
  if (!z.uuid().safeParse(id).success) throw notFound("Klijent nije pronađen.");
  return tenantDb(ctx, async (db) => {
    const r = await db.query(
      `SELECT c.id, c.type, c.display_name AS "displayName", c.status, a.name AS "activityName",
              c.municipality, c.phone, c.email, c.updated_at AS "updatedAt", c.created_at AS "createdAt",
              CASE WHEN rp.user_id IS NULL THEN NULL ELSE rp.first_name || ' ' || rp.last_name END AS "responsibleName",
              c.activity_id AS "activityId", c.responsible_user_id AS "responsibleUserId",
              c.linked_person_id AS "linkedPersonId", lp.display_name AS "linkedPersonName",
              c.address, c.city, c.first_contact_date AS "firstContactDate", c.note,
              pd.first_name AS "firstName", pd.last_name AS "lastName", pd.jmbg_hash IS NOT NULL AS "hasJmbg",
              bd.company_name AS "companyName", bd.registration_number AS "registrationNumber",
              bd.tax_number AS "taxNumber", h.bpg
       FROM clients c
       LEFT JOIN business_activities a ON a.id = c.activity_id
       LEFT JOIN profiles rp ON rp.user_id = c.responsible_user_id
       LEFT JOIN clients lp ON lp.id = c.linked_person_id
       LEFT JOIN client_person_details pd ON pd.client_id = c.id
       LEFT JOIN client_business_details bd ON bd.client_id = c.id
       LEFT JOIN agricultural_holdings h ON h.client_id = c.id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [id, ctx.tenantId],
    );
    if (!r.rows[0]) throw notFound("Klijent nije pronađen.");
    const productions = await db.query(
      `SELECT pc.id, pc.name, cp.is_primary AS "isPrimary"
       FROM client_productions cp JOIN production_categories pc ON pc.id = cp.production_category_id
       WHERE cp.client_id = $1 AND cp.tenant_id = $2 ORDER BY cp.is_primary DESC, pc.sort_order, lower(pc.name)`,
      [id, ctx.tenantId],
    );
    const linked = await db.query(
      `SELECT id, display_name AS "displayName", type FROM clients
       WHERE linked_person_id = $1 AND tenant_id = $2 ORDER BY lower(display_name)`,
      [id, ctx.tenantId],
    );
    return { ...r.rows[0], productions: productions.rows, linkedClients: linked.rows } as ClientDetail;
  });
}

/** Mogući duplikati unutar organizacije. JMBG se poredi samo preko otiska. */
export async function findDuplicates(
  db: Db,
  ctx: TenantCtx,
  input: Pick<ClientInput, "registrationNumber" | "taxNumber" | "bpg" | "email" | "phone"> & { jmbg?: string | null },
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];
  const check = async (field: DuplicateMatch["field"], blocking: boolean, sql: string, value: unknown) => {
    const r = await db.query<{ id: string; display_name: string }>(
      `SELECT c.id, c.display_name FROM clients c ${sql}
       AND c.tenant_id = $2 AND ($3::uuid IS NULL OR c.id <> $3) ORDER BY c.created_at LIMIT 5`,
      [value, ctx.tenantId, excludeId ?? null],
    );
    for (const row of r.rows) matches.push({ field, blocking, clientId: row.id, displayName: row.display_name });
  };
  if (input.registrationNumber)
    await check(
      "registrationNumber",
      true,
      "JOIN client_business_details d ON d.client_id = c.id WHERE d.registration_number = $1",
      input.registrationNumber,
    );
  if (input.taxNumber)
    await check("taxNumber", true, "JOIN client_business_details d ON d.client_id = c.id WHERE d.tax_number = $1", input.taxNumber);
  if (input.bpg)
    await check("bpg", true, "JOIN agricultural_holdings d ON d.client_id = c.id WHERE d.bpg = $1", input.bpg);
  if (input.jmbg)
    await check(
      "jmbg",
      true,
      "JOIN client_person_details d ON d.client_id = c.id WHERE d.jmbg_hash = $1",
      jmbgHash(ctx.tenantId, input.jmbg),
    );
  if (input.email) await check("email", false, "WHERE lower(c.email) = $1", input.email.toLowerCase());
  const phoneDigits = (input.phone ?? "").replace(/\D/g, "");
  if (phoneDigits.length >= 6) await check("phone", false, "WHERE c.phone_digits = $1", phoneDigits);
  return matches;
}

function parse(raw: unknown): ClientInput {
  const parsed = clientFormSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Proverite označena polja.", z.flattenError(parsed.error).fieldErrors);
  return normalizeClient(parsed.data);
}

/** Jedinstveni identifikatori blokiraju čuvanje; email i telefon traže potvrdu. */
async function guardDuplicates(db: Db, ctx: TenantCtx, input: ClientInput, confirmed: boolean, excludeId?: string) {
  const matches = await findDuplicates(db, ctx, input, excludeId);
  if (matches.some((m) => m.blocking))
    throw conflict("Klijent sa istim identifikatorom već postoji u vašoj organizaciji.", {
      blocking: true,
      matches: matches.filter((m) => m.blocking),
    });
  if (matches.length && !confirmed)
    throw conflict("Pronađeni su mogući duplikati. Proverite ih pre čuvanja.", { blocking: false, matches });
}

async function writeDetails(db: Db, ctx: TenantCtx, id: string, input: ClientInput) {
  const t = ctx.tenantId;
  if (input.firstName && input.lastName) {
    await db.query(
      `INSERT INTO client_person_details (client_id, tenant_id, first_name, last_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name`,
      [id, t, input.firstName, input.lastName],
    );
    if (input.jmbg !== undefined)
      await db.query(
        "UPDATE client_person_details SET jmbg_ciphertext = $3, jmbg_hash = $4 WHERE client_id = $1 AND tenant_id = $2",
        [id, t, input.jmbg ? encryptJmbg(input.jmbg) : null, input.jmbg ? jmbgHash(t, input.jmbg) : null],
      );
  } else await db.query("DELETE FROM client_person_details WHERE client_id = $1 AND tenant_id = $2", [id, t]);

  if (input.companyName)
    await db.query(
      `INSERT INTO client_business_details (client_id, tenant_id, company_name, registration_number, tax_number)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (client_id) DO UPDATE SET company_name = EXCLUDED.company_name,
         registration_number = EXCLUDED.registration_number, tax_number = EXCLUDED.tax_number`,
      [id, t, input.companyName, input.registrationNumber, input.taxNumber],
    );
  else await db.query("DELETE FROM client_business_details WHERE client_id = $1 AND tenant_id = $2", [id, t]);

  if (input.bpg)
    await db.query(
      `INSERT INTO agricultural_holdings (client_id, tenant_id, bpg) VALUES ($1, $2, $3)
       ON CONFLICT (client_id) DO UPDATE SET bpg = EXCLUDED.bpg`,
      [id, t, input.bpg],
    );
  else await db.query("DELETE FROM agricultural_holdings WHERE client_id = $1 AND tenant_id = $2", [id, t]);

  await db.query("DELETE FROM client_productions WHERE client_id = $1 AND tenant_id = $2", [id, t]);
  for (const productionId of input.productionIds)
    await db.query(
      "INSERT INTO client_productions (client_id, production_category_id, tenant_id, is_primary) VALUES ($1, $2, $3, $4)",
      [id, productionId, t, productionId === input.primaryProductionId],
    );
}

/** Greške baze koje su posledica unosa prevodi u poruke za korisnika. */
function translateDbError(e: unknown): never {
  const code = pgCode(e);
  if (code === "23505") throw conflict("Klijent sa istim identifikatorom već postoji u vašoj organizaciji.", { blocking: true, matches: [] });
  if (code === "23503") throw invalid("Izabrana vrednost ne postoji u vašoj organizaciji.");
  throw e;
}

async function assertLinkedPerson(db: Db, ctx: TenantCtx, linkedPersonId: string | null) {
  if (!linkedPersonId) return;
  const r = await db.query("SELECT type FROM clients WHERE id = $1 AND tenant_id = $2", [linkedPersonId, ctx.tenantId]);
  if (r.rows[0]?.type !== "person") throw invalid("Povezano lice mora biti klijent tipa fizičko lice.");
}

export async function createClient(
  ctx: TenantCtx,
  raw: unknown,
  options: { confirmDuplicates?: boolean; source?: "import" } = {},
): Promise<{ id: string }> {
  requirePerm(ctx, "create");
  const input = parse(raw);
  if (input.jmbg) requirePerm(ctx, "sensitive");
  return tenantDb(ctx, (db) => insertClient(db, ctx, input, options));
}

/** Upis unutar postojeće transakcije (koristi ga i uvoz). */
export async function insertClient(
  db: Db,
  ctx: TenantCtx,
  input: ClientInput,
  options: { confirmDuplicates?: boolean; source?: "import" } = {},
): Promise<{ id: string }> {
  await guardDuplicates(db, ctx, input, !!options.confirmDuplicates);
  await assertLinkedPerson(db, ctx, input.linkedPersonId);
  try {
    const r = await db.query<{ id: string }>(
      `INSERT INTO clients (tenant_id, type, display_name, status, activity_id, responsible_user_id, linked_person_id,
                            phone, email, address, city, municipality, first_contact_date, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [
        ctx.tenantId, input.type, input.displayName, input.status, input.activityId, input.responsibleUserId,
        input.linkedPersonId, input.phone, input.email, input.address, input.city, input.municipality,
        input.firstContactDate, input.note, ctx.userId,
      ],
    );
    const id = r.rows[0].id;
    await writeDetails(db, ctx, id, input);
    await audit(db, ctx, {
      action: "client.created",
      entityType: "client",
      entityId: id,
      clientId: id,
      summary: `Kreiran klijent „${input.displayName}“${options.source === "import" ? " (uvoz)" : ""}`,
      metadata: { type: input.type, status: input.status, source: options.source ?? "form" },
    });
    return { id };
  } catch (e) {
    translateDbError(e);
  }
}

const TRACKED: [keyof ClientInput, string][] = [
  ["type", "tip klijenta"], ["displayName", "naziv"], ["firstName", "ime"], ["lastName", "prezime"],
  ["companyName", "naziv firme"], ["registrationNumber", "matični broj"], ["taxNumber", "PIB"], ["bpg", "BPG"],
  ["phone", "telefon"], ["email", "email"], ["address", "adresa"], ["city", "mesto"], ["municipality", "opština"],
  ["activityId", "delatnost"], ["linkedPersonId", "povezano lice"], ["firstContactDate", "datum prvog kontakta"],
  ["note", "napomena"],
];

export async function updateClient(
  ctx: TenantCtx,
  id: string,
  raw: unknown,
  options: { confirmDuplicates?: boolean } = {},
): Promise<{ id: string }> {
  requirePerm(ctx, "edit");
  const input = parse(raw);
  if (input.jmbg) requirePerm(ctx, "sensitive");
  const before = await getClient(ctx, id);
  // Bez dozvole za osetljive podatke JMBG se ne može ni ukloniti promenom tipa.
  if (before.hasJmbg && input.jmbg === null && !ctx.perms.sensitive)
    throw invalid("Ova izmena bi uklonila JMBG, za šta je potrebna posebna dozvola.");
  return tenantDb(ctx, async (db) => {
    const locked = await db.query("SELECT id FROM clients WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [id, ctx.tenantId]);
    if (!locked.rows[0]) throw notFound("Klijent nije pronađen.");
    await guardDuplicates(db, ctx, input, !!options.confirmDuplicates, id);
    await assertLinkedPerson(db, ctx, input.linkedPersonId);
    try {
      await db.query(
        `UPDATE clients SET type=$3, display_name=$4, status=$5, activity_id=$6, responsible_user_id=$7,
           linked_person_id=$8, phone=$9, email=$10, address=$11, city=$12, municipality=$13,
           first_contact_date=$14, note=$15
         WHERE id=$1 AND tenant_id=$2`,
        [
          id, ctx.tenantId, input.type, input.displayName, input.status, input.activityId, input.responsibleUserId,
          input.linkedPersonId, input.phone, input.email, input.address, input.city, input.municipality,
          input.firstContactDate, input.note,
        ],
      );
      await writeDetails(db, ctx, id, input);
    } catch (e) {
      translateDbError(e);
    }
    const old = before as unknown as Record<string, unknown>;
    const changed = TRACKED.filter(([key]) => (old[key] ?? null) !== (input[key] ?? null)).map(([, label]) => label);
    const oldProductions = before.productions.map((p) => p.id + (p.isPrimary ? "*" : "")).sort().join();
    const newProductions = input.productionIds.map((p) => p + (p === input.primaryProductionId ? "*" : "")).sort().join();
    if (oldProductions !== newProductions) changed.push("vrste proizvodnje");
    if (input.jmbg !== undefined && (before.hasJmbg || input.jmbg)) changed.push("JMBG");
    const base = { entityType: "client", entityId: id, clientId: id };
    if (changed.length)
      await audit(db, ctx, {
        ...base,
        action: "client.updated",
        summary: `Izmenjeni podaci klijenta: ${changed.join(", ")}`,
        metadata: { fields: changed },
      });
    if (before.status !== input.status)
      await audit(db, ctx, {
        ...base,
        action: "client.status_changed",
        summary: `Status klijenta: ${labels.clientStatus[before.status]} → ${labels.clientStatus[input.status]}`,
        metadata: { from: before.status, to: input.status },
      });
    if (before.responsibleUserId !== input.responsibleUserId)
      await audit(db, ctx, {
        ...base,
        action: "client.responsible_changed",
        summary: "Promenjena odgovorna osoba klijenta",
        metadata: { from: before.responsibleUserId, to: input.responsibleUserId },
      });
    return { id };
  });
}

/** Promena statusa bez otvaranja celog formulara (uključujući arhiviranje). */
export async function setClientStatus(ctx: TenantCtx, id: string, status: ClientStatus) {
  requirePerm(ctx, "edit");
  const before = await getClient(ctx, id);
  if (before.status === status) return;
  await tenantDb(ctx, async (db) => {
    await db.query("UPDATE clients SET status = $3 WHERE id = $1 AND tenant_id = $2", [id, ctx.tenantId, status]);
    await audit(db, ctx, {
      action: "client.status_changed",
      entityType: "client",
      entityId: id,
      clientId: id,
      summary: `Status klijenta: ${labels.clientStatus[before.status]} → ${labels.clientStatus[status]}`,
      metadata: { from: before.status, to: status },
    });
  });
}

/** Pun JMBG, samo uz posebnu dozvolu; svaki pristup se evidentira. */
export async function revealJmbg(ctx: TenantCtx, id: string): Promise<string> {
  requirePerm(ctx, "sensitive");
  if (!z.uuid().safeParse(id).success) throw notFound("Klijent nije pronađen.");
  return tenantDb(ctx, async (db) => {
    const r = await db.query<{ jmbg_ciphertext: string | null }>(
      "SELECT jmbg_ciphertext FROM client_person_details WHERE client_id = $1 AND tenant_id = $2",
      [id, ctx.tenantId],
    );
    if (!r.rows[0]?.jmbg_ciphertext) throw notFound("JMBG nije upisan za ovog klijenta.");
    await audit(db, ctx, {
      action: "client.jmbg_viewed",
      entityType: "client",
      entityId: id,
      clientId: id,
      summary: "Prikazan pun JMBG klijenta",
    });
    return decryptJmbg(r.rows[0].jmbg_ciphertext);
  });
}

/** Kratka lista za izbor klijenta u formularima. */
export async function clientOptions(ctx: TenantCtx, onlyType?: ClientType) {
  requirePerm(ctx, "view");
  return tenantDb(ctx, async (db) => {
    const r = await db.query<{ id: string; name: string }>(
      `SELECT id, display_name AS name FROM clients
       WHERE tenant_id = $1 AND status <> 'archived' AND ($2::text IS NULL OR type = $2)
       ORDER BY lower(display_name) LIMIT 2000`,
      [ctx.tenantId, onlyType ?? null],
    );
    return r.rows;
  });
}
