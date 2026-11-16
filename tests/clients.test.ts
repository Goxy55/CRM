import { beforeAll, describe, expect, it } from "vitest";
import type { TenantCtx } from "@/server/context";
import { withContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { createClient, getClient, listClients, revealJmbg, setClientStatus, updateClient } from "@/server/services/clients";
import { getDashboard, listAudit } from "@/server/services/dashboard";
import { getLookups } from "@/server/services/lookups";
import { emptyClientForm } from "@/lib/schemas";
import { addMember, company, digits, errorCode, fakeJmbg, makeTenant, person } from "./helpers";

let admin: TenantCtx;
let productions: Record<string, string>;
let activities: Record<string, string>;

beforeAll(async () => {
  admin = (await makeTenant("Klijenti")).admin;
  const lookups = await getLookups(admin);
  productions = Object.fromEntries(lookups.productions.map((p) => [p.name, p.id]));
  activities = Object.fromEntries(lookups.activities.map((p) => [p.name, p.id]));
});

describe("klijenti", () => {
  it("nova organizacija dobija podesive šifarnike", () => {
    expect(Object.keys(productions)).toHaveLength(8);
    expect(productions).toHaveProperty("Pčelarstvo");
    expect(activities).toHaveProperty("Poljoprivreda");
  });

  it("kreira sva četiri tipa i čuva samo polja koja pripadaju tipu", async () => {
    const p = await getClient(admin, (await createClient(admin, person({ firstName: "Ana", lastName: "Anić", companyName: "Zanemareno", taxNumber: digits(9) }))).id);
    expect(p).toMatchObject({ type: "person", displayName: "Ana Anić", companyName: null, taxNumber: null });
    const c = await getClient(admin, (await createClient(admin, company({ companyName: "TEST Agro d.o.o.", registrationNumber: "12345678", firstName: "X" }))).id);
    expect(c).toMatchObject({ type: "company", displayName: "TEST Agro d.o.o.", registrationNumber: "12345678", firstName: null });
    const e = await getClient(admin, (await createClient(admin, { ...emptyClientForm, type: "entrepreneur", companyName: "TEST SZR Kovač", firstName: "Mile", lastName: "Kovač" })).id);
    expect(e).toMatchObject({ type: "entrepreneur", displayName: "TEST SZR Kovač", firstName: "Mile" });
    expect(await errorCode(createClient(admin, { ...emptyClientForm, type: "company" }))).toBe("VALIDATION");
    expect(await errorCode(createClient(admin, person({ email: "nije-email" })))).toBe("VALIDATION");
    expect(await errorCode(createClient(admin, company({ taxNumber: "123" })))).toBe("VALIDATION");
  });

  it("gazdinstvo ima više proizvodnji, jednu primarnu, i vezu sa fizičkim licem", async () => {
    const holder = await createClient(admin, person({ firstName: "Jovan", lastName: "Jović" }));
    const farm = await createClient(admin, {
      ...person({ firstName: "Jovan", lastName: "Jović" }),
      type: "farm",
      bpg: digits(12),
      linkedPersonId: holder.id,
      productionIds: [productions["Ratarstvo"], productions["Stočarstvo"], productions["Pčelarstvo"]],
      primaryProductionId: productions["Stočarstvo"],
      activityId: activities["Poljoprivreda"],
    });
    const detail = await getClient(admin, farm.id);
    expect(detail.productions.map((x) => x.name).sort()).toEqual(["Pčelarstvo", "Ratarstvo", "Stočarstvo"]);
    expect(detail.productions.filter((x) => x.isPrimary).map((x) => x.name)).toEqual(["Stočarstvo"]);
    expect(detail.linkedPersonId).toBe(holder.id);
    expect((await getClient(admin, holder.id)).linkedClients.map((x) => x.id)).toEqual([farm.id]);
    const rows = await withContext({ tenantId: admin.tenantId }, (db) =>
      db.query("SELECT count(*)::int AS n FROM client_productions WHERE client_id = $1", [farm.id]),
    );
    expect(rows.rows[0].n).toBe(3);
    expect(await errorCode(createClient(admin, { ...person(), type: "farm", productionIds: [productions["Ratarstvo"]], primaryProductionId: productions["Voćarstvo"] }))).toBe("VALIDATION");
  });

  it("izmena menja podatke i ostavlja trag: polja, status, odgovorna osoba", async () => {
    const member = await addMember(admin);
    const { id } = await createClient(admin, company({ companyName: "TEST Izmena d.o.o.", phone: "011 111 111" }));
    await updateClient(member, id, company({ companyName: "TEST Izmena d.o.o.", phone: "011 222 222", municipality: "Šabac", status: "active", responsibleUserId: member.userId }));
    expect(await getClient(admin, id)).toMatchObject({ phone: "011 222 222", municipality: "Šabac", status: "active", responsibleName: member.userName });
    await setClientStatus(admin, id, "archived");
    const log = (await listAudit(admin, { clientId: id })).rows;
    expect(log.map((r) => r.action)).toEqual(expect.arrayContaining(["client.created", "client.updated", "client.status_changed", "client.responsible_changed"]));
    expect(log.find((r) => r.action === "client.updated")?.summary).toMatch(/telefon.*opština/);
    expect(log.find((r) => r.action === "client.updated")?.userName).toBe(member.userName);
    expect(log.filter((r) => r.action === "client.status_changed").map((r) => r.summary)).toEqual(
      expect.arrayContaining(["Status klijenta: Potencijalni → Aktivan", "Status klijenta: Aktivan → Arhiviran"]),
    );
    expect((await listClients(admin, { q: "TEST Izmena" })).total).toBe(0);
    expect((await listClients(admin, { q: "TEST Izmena", status: "archived" })).total).toBe(1);
  });

  it("pokazatelji na početnoj prate promene u bazi", async () => {
    const before = (await getDashboard(admin)).kpis;
    const { id } = await createClient(admin, person({ status: "active" }));
    const after = (await getDashboard(admin)).kpis;
    expect(after.totalClients).toBe(before.totalClients + 1);
    expect(after.activeClients).toBe(before.activeClients + 1);
    expect(after.newThisMonth).toBe(before.newThisMonth + 1);
    await setClientStatus(admin, id, "archived");
    expect((await getDashboard(admin)).kpis).toEqual(before);
  });
});

describe("kontrola duplikata", () => {
  it("jedinstveni identifikatori (MB, PIB, BPG) blokiraju čuvanje", async () => {
    const mb = digits(8), pib = digits(9), bpg = digits(12);
    const first = await createClient(admin, company({ companyName: "TEST Original d.o.o.", registrationNumber: mb, taxNumber: pib }));
    await createClient(admin, { ...person(), type: "farm", bpg });
    for (const duplicate of [company({ registrationNumber: mb }), company({ taxNumber: pib }), { ...person(), type: "farm" as const, bpg }]) {
      const error = await createClient(admin, duplicate, { confirmDuplicates: true }).catch((e) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("CONFLICT");
      expect(error.details.blocking).toBe(true);
    }
    const error = await createClient(admin, company({ taxNumber: pib })).catch((e) => e);
    expect(error.details.matches[0]).toMatchObject({ field: "taxNumber", clientId: first.id, displayName: "TEST Original d.o.o." });
    const other = await createClient(admin, company());
    expect(await errorCode(updateClient(admin, other.id, company({ taxNumber: pib })))).toBe("CONFLICT");
    expect(await errorCode(updateClient(admin, first.id, company({ companyName: "TEST Original d.o.o.", registrationNumber: mb, taxNumber: pib })))).toBe("OK");
  });

  it("isti email ili telefon daje upozorenje, a čuvanje je moguće uz potvrdu", async () => {
    const email = `dup-${digits(6)}@example.test`;
    const first = await createClient(admin, person({ email, phone: "+381 64 123-45-67" }));
    const warn = await createClient(admin, person({ email: email.toUpperCase() })).catch((e) => e);
    expect(warn.code).toBe("CONFLICT");
    expect(warn.details.blocking).toBe(false);
    expect(warn.details.matches).toEqual([expect.objectContaining({ field: "email", clientId: first.id })]);
    const phone = await createClient(admin, person({ phone: "381641234567" })).catch((e) => e);
    expect(phone.details.matches[0].field).toBe("phone");
    expect(await errorCode(createClient(admin, person({ email }), { confirmDuplicates: true }))).toBe("OK");
  });
});

describe("pretraga i filteri", () => {
  it("pronalazi po nazivu, identifikatorima, kontaktu, delatnosti i proizvodnji", async () => {
    const pib = digits(9), mb = digits(8), bpg = digits(12), tag = `Zz${digits(5)}`;
    await createClient(admin, company({ companyName: `TEST ${tag} Mlin d.o.o.`, taxNumber: pib, registrationNumber: mb, email: `${tag}@example.test`, phone: "065/555-0101", municipality: "Ruma", activityId: activities["Trgovina"] }));
    await createClient(admin, { ...person({ firstName: "Mira", lastName: `${tag}ić` }), type: "farm", bpg, productionIds: [productions["Vinogradarstvo"]], municipality: "Inđija", status: "active" });
    const count = async (q: string, extra = {}) => (await listClients(admin, { q, ...extra })).total;
    expect(await count(tag)).toBe(2);
    expect(await count(`${tag.toLowerCase()} mlin`)).toBe(1);
    expect(await count(pib)).toBe(1);
    expect(await count(mb)).toBe(1);
    expect(await count(bpg)).toBe(1);
    expect(await count(`${tag}@example`)).toBe(1);
    expect(await count("0655550101")).toBe(1);
    expect(await count(`${tag} trgovina`)).toBe(1);
    expect(await count(`${tag} vinogradarstvo`)).toBe(1);
    expect(await count(`${tag} Mira`)).toBe(1);
    expect(await count(tag, { type: "farm" })).toBe(1);
    expect(await count(tag, { status: "active", municipality: "inđ" })).toBe(1);
    expect(await count(tag, { productionId: productions["Vinogradarstvo"], activityId: activities["Trgovina"] })).toBe(0);
    expect(await count("100%_nepostojece")).toBe(0);
  });
});

describe("JMBG", () => {
  it("čuva se šifrovano, prikazuje samo ovlašćenima i svaki pristup se beleži", async () => {
    const sensitive = await addMember(admin, { canViewSensitive: true });
    const regular = await addMember(admin);
    const jmbg = fakeJmbg();
    expect(await errorCode(createClient(regular, person({ jmbg })))).toBe("FORBIDDEN");
    expect(await errorCode(createClient(sensitive, person({ jmbg: "1234567890123" })))).toBe("VALIDATION");
    const { id } = await createClient(sensitive, person({ jmbg }));

    const stored = await withContext({ tenantId: admin.tenantId }, (db) => db.query("SELECT * FROM client_person_details WHERE client_id = $1", [id]));
    expect(JSON.stringify(stored.rows[0])).not.toContain(jmbg);
    expect(stored.rows[0].jmbg_ciphertext).toMatch(/^v1\./);

    const detail = await getClient(regular, id);
    expect(detail.hasJmbg).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(jmbg);
    expect(await errorCode(revealJmbg(regular, id))).toBe("FORBIDDEN");
    expect(await errorCode(revealJmbg(admin, id))).toBe("FORBIDDEN");
    expect(await revealJmbg(sensitive, id)).toBe(jmbg);

    expect(await errorCode(listClients(regular, { jmbg }))).toBe("FORBIDDEN");
    expect((await listClients(sensitive, { jmbg })).rows.map((r) => r.id)).toEqual([id]);
    expect((await listClients(sensitive, { q: jmbg })).total).toBe(0);
    expect(await errorCode(createClient(sensitive, person({ jmbg })))).toBe("CONFLICT");

    const log = (await listAudit(admin)).rows;
    expect(log.some((r) => r.action === "client.jmbg_viewed" && r.userName === sensitive.userName)).toBe(true);
    expect(log.some((r) => r.action === "client.jmbg_searched")).toBe(true);
    const raw = await withContext({ tenantId: admin.tenantId }, (db) => db.query("SELECT summary, metadata FROM audit_logs"));
    expect(JSON.stringify(raw.rows)).not.toContain(jmbg);

    // Izmena bez dozvole ne dira JMBG; uklanjanje traži dozvolu.
    await updateClient(regular, id, person({ firstName: "Novo", lastName: "Ime" }));
    expect(await revealJmbg(sensitive, id)).toBe(jmbg);
    expect(await errorCode(updateClient(regular, id, { ...person(), removeJmbg: true }))).toBe("VALIDATION");
    await updateClient(sensitive, id, { ...person(), removeJmbg: true });
    expect((await getClient(admin, id)).hasJmbg).toBe(false);
  });
});

describe("dozvole", () => {
  it("unos, izmena i pregled zavise od dodeljenih dozvola", async () => {
    const readOnly = await addMember(admin, { canCreate: false, canEdit: false });
    const noView = await addMember(admin, { canView: false, canCreate: false, canEdit: false });
    const { id } = await createClient(admin, person());
    expect(await errorCode(createClient(readOnly, person()))).toBe("FORBIDDEN");
    expect(await errorCode(updateClient(readOnly, id, person()))).toBe("FORBIDDEN");
    expect(await errorCode(setClientStatus(readOnly, id, "active"))).toBe("FORBIDDEN");
    expect(await errorCode(getClient(readOnly, id))).toBe("OK");
    expect(await errorCode(getClient(noView, id))).toBe("FORBIDDEN");
    expect(await errorCode(listClients(noView))).toBe("FORBIDDEN");
    expect(await errorCode(listAudit(readOnly))).toBe("FORBIDDEN");
  });
});
