import { audit } from "../audit";
import { requirePerm, tenantDb, type TenantCtx } from "../context";
import { savepoint, type Db } from "../db";
import { AppError, invalid } from "../errors";
import { CLIENT_STATUSES, CLIENT_TYPES, type ClientStatus, type ClientType } from "@/lib/domain";
import { clientFormSchema, emptyClientForm, normalizeClient, type ClientFormValues, type ClientInput } from "@/lib/schemas";
import { labels } from "@/i18n";
import { findDuplicates, insertClient } from "./clients";

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 2000;

/** Polja koja se mogu uvesti. JMBG se namerno ne uvozi iz datoteka. */
export const IMPORT_FIELDS = [
  { key: "type", label: "Tip klijenta", aliases: ["tip", "tip klijenta", "vrsta klijenta"] },
  { key: "firstName", label: "Ime", aliases: ["ime"] },
  { key: "lastName", label: "Prezime", aliases: ["prezime"] },
  { key: "companyName", label: "Naziv firme", aliases: ["naziv", "naziv firme", "firma", "pravno lice", "naziv pravnog lica"] },
  { key: "registrationNumber", label: "Matični broj", aliases: ["maticni broj", "mb", "maticni"] },
  { key: "taxNumber", label: "PIB", aliases: ["pib"] },
  { key: "bpg", label: "BPG", aliases: ["bpg", "broj gazdinstva", "broj poljoprivrednog gazdinstva"] },
  { key: "phone", label: "Telefon", aliases: ["telefon", "tel", "mobilni", "broj telefona"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail", "mejl", "e-posta"] },
  { key: "address", label: "Adresa", aliases: ["adresa", "ulica"] },
  { key: "city", label: "Mesto", aliases: ["mesto", "grad", "naselje"] },
  { key: "municipality", label: "Opština", aliases: ["opstina"] },
  { key: "activity", label: "Delatnost", aliases: ["delatnost"] },
  { key: "status", label: "Status klijenta", aliases: ["status", "status klijenta"] },
  { key: "firstContactDate", label: "Datum prvog kontakta", aliases: ["datum prvog kontakta", "prvi kontakt", "datum"] },
  { key: "productions", label: "Vrste proizvodnje (odvojene zarezom)", aliases: ["proizvodnja", "vrsta proizvodnje", "proizvodnje"] },
  { key: "note", label: "Napomena", aliases: ["napomena", "komentar", "beleska"] },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
/** Polje → indeks kolone u datoteci. */
export type ImportMapping = Partial<Record<ImportField, number>>;

const fold = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "dj").replace(/\s+/g, " ").trim();

/** Predlog mapiranja po nazivima kolona; korisnik ga potvrđuje ili menja. */
export function suggestMapping(columns: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const folded = columns.map(fold);
  for (const field of IMPORT_FIELDS) {
    const index = folded.findIndex((c) => (field.aliases as readonly string[]).includes(c));
    if (index >= 0) mapping[field.key] = index;
  }
  return mapping;
}

function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n") >>> 0);
  const delimiter = [";", "\t", ","].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) (row.push(cell), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) (row.push(cell), rows.push(row));
  return rows;
}

function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Excel na srpskom Windows-u često čuva CSV u kodnoj strani 1250.
    return new TextDecoder("windows-1250").decode(bytes);
  }
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (v.richText) return v.richText.map((p) => p.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return cellText(v.result);
    return "";
  }
  return String(value);
}

/**
 * Čita .xlsx ili .csv u memoriji i vraća zaglavlje i redove kao tekst.
 * Datoteka se ne čuva; tip se utvrđuje po sadržaju.
 */
export async function parseImportFile(filename: string, bytes: Buffer): Promise<{ columns: string[]; rows: string[][] }> {
  if (!bytes.length) throw invalid("Datoteka je prazna.");
  if (bytes.length > IMPORT_MAX_BYTES) throw invalid("Datoteka je veća od 5 MB.");
  let table: string[][];
  if (bytes.subarray(0, 2).toString() === "PK") {
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    try {
      await book.xlsx.load(bytes as unknown as ArrayBuffer);
    } catch {
      throw invalid("Datoteka nije ispravan .xlsx dokument.");
    }
    const sheet = book.worksheets[0];
    if (!sheet) throw invalid("Dokument nema nijedan radni list.");
    table = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[];
      table.push(Array.from({ length: Math.max(values.length - 1, 0) }, (_, i) => cellText(values[i + 1]).trim()));
    });
  } else if (/\.csv$/i.test(filename) || /\.txt$/i.test(filename)) {
    table = parseCsv(decodeText(bytes).replace(/^﻿/, "")).map((r) => r.map((c) => c.trim()));
  } else throw invalid("Podržane su .xlsx i .csv datoteke.");
  table = table.filter((r) => r.some((c) => c !== ""));
  if (table.length < 2) throw invalid("Datoteka mora imati zaglavlje i bar jedan red podataka.");
  const [header, ...rows] = table;
  if (rows.length > IMPORT_MAX_ROWS) throw invalid(`Datoteka ima više od ${IMPORT_MAX_ROWS} redova. Podelite je na manje delove.`);
  const columns = header.map((c, i) => c || `Kolona ${i + 1}`);
  return { columns, rows: rows.map((r) => columns.map((_, i) => r[i] ?? "")) };
}

const TYPE_WORDS: [ClientType, string[]][] = [
  ["person", ["fizicko lice", "fizicko", "lice"]],
  ["farm", ["poljoprivredno gazdinstvo", "gazdinstvo", "rpg", "pg"]],
  ["entrepreneur", ["preduzetnik", "pr", "radnja"]],
  ["company", ["privredno drustvo", "firma", "doo", "d.o.o.", "pravno lice", "preduzece"]],
];

function parseDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})\.?$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

type Lookup = Map<string, string>;
type Prepared = { input?: ClientInput; name: string; errors: string[] };

function prepareRow(mapping: ImportMapping, row: string[], activities: Lookup, productions: Lookup): Prepared {
  const get = (field: ImportField) => {
    const index = mapping[field];
    return index == null ? "" : (row[index] ?? "").trim();
  };
  const errors: string[] = [];
  const form: ClientFormValues = { ...emptyClientForm };
  form.firstName = get("firstName");
  form.lastName = get("lastName");
  form.companyName = get("companyName");
  for (const key of ["registrationNumber", "taxNumber", "bpg"] as const) form[key] = get(key).replace(/[\s.\-/]/g, "");
  form.phone = get("phone");
  form.email = get("email");
  form.address = get("address");
  form.city = get("city");
  form.municipality = get("municipality");
  form.note = get("note");

  const typeText = fold(get("type"));
  if (typeText) {
    const found = CLIENT_TYPES.find((t) => t === typeText) ?? TYPE_WORDS.find(([, words]) => words.includes(typeText))?.[0];
    if (found) form.type = found;
    else errors.push(`Nepoznat tip klijenta „${get("type")}“.`);
  } else form.type = form.companyName ? (form.firstName && form.lastName ? "entrepreneur" : "company") : form.bpg ? "farm" : "person";

  const statusText = fold(get("status"));
  if (statusText) {
    const found = CLIENT_STATUSES.find((s) => s === statusText || fold(labels.clientStatus[s]) === statusText);
    if (found) form.status = found as ClientStatus;
    else errors.push(`Nepoznat status „${get("status")}“.`);
  }

  const activity = get("activity");
  if (activity) {
    const id = activities.get(fold(activity));
    if (id) form.activityId = id;
    else errors.push(`Delatnost „${activity}“ ne postoji u šifarniku organizacije.`);
  }

  const date = get("firstContactDate");
  if (date) {
    const parsed = parseDate(date);
    if (parsed) form.firstContactDate = parsed;
    else errors.push(`Datum „${date}“ nije prepoznat (očekuje se DD.MM.GGGG ili GGGG-MM-DD).`);
  }

  const names = get("productions").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  for (const name of names) {
    const id = productions.get(fold(name));
    if (id) form.productionIds.push(id);
    else errors.push(`Vrsta proizvodnje „${name}“ ne postoji u šifarniku organizacije.`);
  }
  form.productionIds = [...new Set(form.productionIds)];
  form.agricultural = form.type === "farm" || !!form.bpg || form.productionIds.length > 0;

  const name = form.companyName || `${form.firstName} ${form.lastName}`.trim() || "(bez naziva)";
  const parsed = clientFormSchema.safeParse(form);
  if (!parsed.success) errors.push(...parsed.error.issues.map((i) => i.message));
  if (errors.length) return { name, errors: [...new Set(errors)] };
  return { name, errors, input: normalizeClient(parsed.data!) };
}

export type ImportRowResult = {
  /** Redni broj u datoteci (zaglavlje je red 1). */
  line: number;
  name: string;
  status: "ok" | "warning" | "error";
  messages: string[];
};

export type ImportAnalysis = { rows: ImportRowResult[]; ok: number; warnings: number; errors: number };

async function loadLookups(db: Db, ctx: TenantCtx) {
  const load = async (table: string): Promise<Lookup> => {
    const r = await db.query<{ id: string; name: string }>(`SELECT id, name FROM ${table} WHERE tenant_id = $1 AND active`, [ctx.tenantId]);
    return new Map(r.rows.map((x) => [fold(x.name), x.id]));
  };
  return { activities: await load("business_activities"), productions: await load("production_categories") };
}

/**
 * Validacija svih redova i provera duplikata — u bazi organizacije i unutar
 * same datoteke. Ista funkcija se koristi za pregled i za sam uvoz.
 */
async function analyze(db: Db, ctx: TenantCtx, mapping: ImportMapping, rows: string[][]) {
  const { activities, productions } = await loadLookups(db, ctx);
  const seen = new Map<string, number>();
  const results: (ImportRowResult & { input?: ClientInput })[] = [];
  for (const [i, row] of rows.entries()) {
    const line = i + 2;
    const prepared = prepareRow(mapping, row, activities, productions);
    if (!prepared.input) {
      results.push({ line, name: prepared.name, status: "error", messages: prepared.errors });
      continue;
    }
    const input = prepared.input;
    const messages: string[] = [];
    let status: ImportRowResult["status"] = "ok";
    for (const key of ["registrationNumber", "taxNumber", "bpg"] as const) {
      const value = input[key];
      if (!value) continue;
      const first = seen.get(`${key}:${value}`);
      if (first) {
        status = "error";
        messages.push(`${labels.duplicateField[key]} ${value} se ponavlja u datoteci (red ${first}).`);
      } else seen.set(`${key}:${value}`, line);
    }
    for (const match of await findDuplicates(db, ctx, input)) {
      const field = labels.duplicateField[match.field];
      if (match.blocking) {
        status = "error";
        messages.push(`${field}: klijent već postoji („${match.displayName}“).`);
      } else {
        if (status === "ok") status = "warning";
        messages.push(`Moguć duplikat (${field.toLowerCase()}): „${match.displayName}“.`);
      }
    }
    results.push({ line, name: prepared.name, status, messages: [...new Set(messages)], input });
  }
  return results;
}

const summarize = (rows: ImportRowResult[]): ImportAnalysis => ({
  rows,
  ok: rows.filter((r) => r.status === "ok").length,
  warnings: rows.filter((r) => r.status === "warning").length,
  errors: rows.filter((r) => r.status === "error").length,
});

function checkInput(mapping: ImportMapping, rows: string[][]) {
  if (!Array.isArray(rows) || !rows.length) throw invalid("Nema redova za uvoz.");
  if (rows.length > IMPORT_MAX_ROWS) throw invalid(`Najviše ${IMPORT_MAX_ROWS} redova po uvozu.`);
  const known = new Set<string>(IMPORT_FIELDS.map((f) => f.key));
  for (const [key, index] of Object.entries(mapping))
    if (!known.has(key) || !Number.isInteger(index) || (index as number) < 0) throw invalid("Neispravno mapiranje kolona.");
  if (mapping.companyName == null && (mapping.firstName == null || mapping.lastName == null))
    throw invalid("Mapirajte bar „Naziv firme“ ili „Ime“ i „Prezime“.");
}

/** Pregled pre uvoza: ništa se ne upisuje. */
export async function previewImport(ctx: TenantCtx, mapping: ImportMapping, rows: string[][]): Promise<ImportAnalysis> {
  requirePerm(ctx, "create");
  checkInput(mapping, rows);
  const results = await tenantDb(ctx, (db) => analyze(db, ctx, mapping, rows));
  return summarize(results.map(({ input: _input, ...r }) => r));
}

export type ImportReport = { imported: number; rejected: ImportRowResult[] };

/**
 * Uvoz u aktivnu organizaciju prijavljenog korisnika. Organizacija se nikada
 * ne čita iz datoteke. Redovi sa greškom se preskaču; redovi sa mogućim
 * duplikatom uvoze se samo uz izričitu potvrdu.
 */
export async function commitImport(
  ctx: TenantCtx,
  mapping: ImportMapping,
  rows: string[][],
  options: { includeWarnings?: boolean } = {},
): Promise<ImportReport> {
  requirePerm(ctx, "create");
  checkInput(mapping, rows);
  return tenantDb(ctx, async (db) => {
    const results = await analyze(db, ctx, mapping, rows);
    const rejected: ImportRowResult[] = [];
    let imported = 0;
    for (const { input, ...row } of results) {
      if (row.status === "error" || !input) {
        rejected.push(row);
        continue;
      }
      if (row.status === "warning" && !options.includeWarnings) {
        rejected.push({ ...row, messages: [...row.messages, "Preskočeno: moguć duplikat nije potvrđen."] });
        continue;
      }
      try {
        await savepoint(db, () => insertClient(db, ctx, input, { confirmDuplicates: true, source: "import" }));
        imported++;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        rejected.push({ ...row, status: "error", messages: [e.message] });
      }
    }
    await audit(db, ctx, {
      action: "import.completed",
      entityType: "import",
      summary: `Uvoz klijenata: uvezeno ${imported}, odbijeno ${rejected.length}`,
      metadata: { imported, rejected: rejected.length, total: rows.length },
    });
    return { imported, rejected };
  });
}
