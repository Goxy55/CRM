import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import type { TenantCtx } from "@/server/context";
import { createClient, getClient, listClients } from "@/server/services/clients";
import { listAudit } from "@/server/services/dashboard";
import { commitImport, parseImportFile, previewImport, suggestMapping } from "@/server/services/import";
import { addMember, company, digits, errorCode, makeTenant } from "./helpers";

let admin: TenantCtx, other: TenantCtx;
const existingPib = digits(9);

beforeAll(async () => {
  admin = (await makeTenant("Uvoz")).admin;
  other = (await makeTenant("Uvoz druga")).admin;
  await createClient(admin, company({ companyName: "TEST Postojeći d.o.o.", taxNumber: existingPib, email: "postojeci@example.test" }));
});

const HEADER = "Tip;Ime;Prezime;Naziv firme;PIB;Matični broj;BPG;Telefon;E-mail;Opština;Delatnost;Status;Proizvodnja;Datum prvog kontakta;tenant_id";

describe("čitanje datoteke", () => {
  it("čita CSV sa tačka-zarezom, navodnicima i kodnom stranom Windows-1250", async () => {
    const utf8 = `﻿${HEADER}\r\n;Žarko;Čolić;;;;;"064 111; 222";;Šid;;;;;\r\n`;
    const parsed = await parseImportFile("klijenti.csv", Buffer.from(utf8));
    expect(parsed.columns[0]).toBe("Tip");
    expect(parsed.rows[0].slice(1, 3)).toEqual(["Žarko", "Čolić"]);
    expect(parsed.rows[0][7]).toBe("064 111; 222");
    // "Žarko;Čolić" u Windows-1250: Ž = 0x8E, Č = 0xC8, ć = 0xE6.
    const cp1250 = Buffer.concat([Buffer.from("Ime;Prezime\n"), Buffer.from([0x8e]), Buffer.from("arko;"), Buffer.from([0xc8]), Buffer.from("oli"), Buffer.from([0xe6]), Buffer.from("\n")]);
    expect((await parseImportFile("stari.csv", cp1250)).rows[0]).toEqual(["Žarko", "Čolić"]);
  });

  it("čita .xlsx i odbija nepodržane, prazne i prevelike datoteke", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Klijenti");
    sheet.addRow(["Naziv firme", "PIB", "Datum prvog kontakta"]);
    sheet.addRow(["TEST Excel d.o.o.", 123456789, new Date("2026-03-15T00:00:00Z")]);
    const parsed = await parseImportFile("klijenti.xlsx", Buffer.from(await book.xlsx.writeBuffer()));
    expect(parsed).toEqual({ columns: ["Naziv firme", "PIB", "Datum prvog kontakta"], rows: [["TEST Excel d.o.o.", "123456789", "2026-03-15"]] });
    expect(await errorCode(parseImportFile("slika.png", Buffer.from("nije tabela")))).toBe("VALIDATION");
    expect(await errorCode(parseImportFile("prazno.csv", Buffer.alloc(0)))).toBe("VALIDATION");
    expect(await errorCode(parseImportFile("samo-zaglavlje.csv", Buffer.from("Ime;Prezime\n")))).toBe("VALIDATION");
    expect(await errorCode(parseImportFile("veliko.csv", Buffer.alloc(6 * 1024 * 1024, "a")))).toBe("VALIDATION");
  });

  it("predlaže mapiranje po nazivima kolona", () => {
    expect(suggestMapping(HEADER.split(";"))).toEqual({
      type: 0, firstName: 1, lastName: 2, companyName: 3, taxNumber: 4, registrationNumber: 5, bpg: 6, phone: 7,
      email: 8, municipality: 9, activity: 10, status: 11, productions: 12, firstContactDate: 13,
    });
  });
});

describe("uvoz klijenata", () => {
  const newPib = digits(9), bpg = digits(12), repeated = digits(9);
  const rows = [
    ["", "", "", "TEST Uvezena firma d.o.o.", newPib, "", "", "011/222-333", "uvezena@example.test", "Novi Sad", "Trgovina", "Aktivan", "", "15.03.2026.", other?.tenantId ?? "x"],
    ["Gazdinstvo", "Milan", "Uvozić", "", "", "", bpg, "", "", "Sombor", "Poljoprivreda", "", "Ratarstvo, Stočarstvo", "2026-02-01", ""],
    ["", "Bez", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "TEST Duplikat PIB", existingPib, "", "", "", "", "", "", "", "", "", ""],
    ["", "Moguć", "Duplikat", "", "", "", "", "", "postojeci@example.test", "", "", "", "", "", ""],
    ["", "", "", "TEST Loši podaci", "12", "", "", "", "nije-email", "", "Nepostojeća delatnost", "Čudan", "Astronomija", "juče", ""],
    ["", "", "", "TEST Ponovljen A", repeated, "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "TEST Ponovljen B", repeated, "", "", "", "", "", "", "", "", "", ""],
  ];
  const mapping = suggestMapping(HEADER.split(";"));

  it("pregled pre uvoza razvrstava redove i objašnjava greške, bez upisa", async () => {
    rows[0][14] = other.tenantId;
    const before = (await listClients(admin)).total;
    const preview = await previewImport(admin, mapping, rows);
    expect(preview).toMatchObject({ ok: 3, warnings: 1, errors: 4 });
    expect(preview.rows.map((r) => `${r.line}:${r.status}`)).toEqual(["2:ok", "3:ok", "4:error", "5:error", "6:warning", "7:error", "8:ok", "9:error"]);
    const messages = (line: number) => preview.rows.find((r) => r.line === line)!.messages.join(" | ");
    expect(messages(4)).toMatch(/Unesite prezime/);
    expect(messages(5)).toMatch(/PIB: klijent već postoji \(„TEST Postojeći d\.o\.o\.“\)/);
    expect(messages(6)).toMatch(/Moguć duplikat \(email\)/);
    expect(messages(7)).toMatch(/PIB ima tačno 9 cifara/);
    expect(messages(7)).toMatch(/Neispravna email adresa/);
    expect(messages(7)).toMatch(/Delatnost „Nepostojeća delatnost“ ne postoji/);
    expect(messages(7)).toMatch(/Nepoznat status „Čudan“/);
    expect(messages(7)).toMatch(/Vrsta proizvodnje „Astronomija“/);
    expect(messages(7)).toMatch(/Datum „juče“ nije prepoznat/);
    expect(messages(9)).toMatch(/se ponavlja u datoteci \(red 8\)/);
    expect((await listClients(admin)).total).toBe(before);
  });

  it("uvozi ispravne redove u aktivnu organizaciju i daje izveštaj o odbijenim", async () => {
    const report = await commitImport(admin, mapping, rows);
    expect(report.imported).toBe(3);
    expect(report.rejected.map((r) => r.line)).toEqual([4, 5, 6, 7, 9]);
    expect(report.rejected.find((r) => r.line === 6)!.messages.join()).toMatch(/moguć duplikat nije potvrđen/);

    const firm = (await listClients(admin, { q: newPib })).rows[0];
    expect(await getClient(admin, firm.id)).toMatchObject({
      type: "company", status: "active", municipality: "Novi Sad", activityName: "Trgovina",
      firstContactDate: "2026-03-15", phone: "011/222-333", email: "uvezena@example.test",
    });
    const farm = await getClient(admin, (await listClients(admin, { q: bpg })).rows[0].id);
    expect(farm).toMatchObject({ type: "farm", displayName: "Milan Uvozić", bpg, status: "potential" });
    expect(farm.productions.map((p) => p.name).sort()).toEqual(["Ratarstvo", "Stočarstvo"]);

    // Kolona tenant_id iz datoteke nema nikakvo dejstvo.
    expect((await listClients(other)).total).toBe(0);
    const log = (await listAudit(admin)).rows;
    expect(log.find((r) => r.action === "import.completed")?.summary).toBe("Uvoz klijenata: uvezeno 3, odbijeno 5");
    expect(log.filter((r) => r.action === "client.created" && r.summary.includes("(uvoz)"))).toHaveLength(3);
  });

  it("ponovljeni uvoz ne pravi duplikate; mogući duplikati se uvoze samo uz potvrdu", async () => {
    const again = await commitImport(admin, mapping, rows);
    expect(again.imported).toBe(0);
    const confirmed = await commitImport(admin, mapping, [rows[4]], { includeWarnings: true });
    expect(confirmed).toMatchObject({ imported: 1, rejected: [] });
  });

  it("uvoz traži dozvolu za unos i ispravno mapiranje", async () => {
    const readOnly = await addMember(admin, { canCreate: false });
    expect(await errorCode(previewImport(readOnly, mapping, rows))).toBe("FORBIDDEN");
    expect(await errorCode(commitImport(readOnly, mapping, rows))).toBe("FORBIDDEN");
    expect(await errorCode(previewImport(admin, { phone: 7 }, rows))).toBe("VALIDATION");
    expect(await errorCode(previewImport(admin, { companyName: 3, tenantId: 14 } as never, rows))).toBe("VALIDATION");
  });
});
