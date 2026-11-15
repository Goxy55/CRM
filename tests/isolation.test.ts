import { beforeAll, describe, expect, it } from "vitest";
import { loadTenantCtx, type TenantCtx } from "@/server/context";
import { withContext } from "@/server/db";
import { createClient, getClient, listClients, revealJmbg, setClientStatus, updateClient } from "@/server/services/clients";
import { createCollaboration, getCollaboration, listCollaborations } from "@/server/services/collaborations";
import { createService, listServices, setServiceActive } from "@/server/services/catalog";
import { getDashboard, listAudit } from "@/server/services/dashboard";
import { getLookups } from "@/server/services/lookups";
import { runReport } from "@/server/services/reports";
import { listTenants, setTenantStatus } from "@/server/services/tenants";
import { updateMember } from "@/server/services/users";
import { addMember, company, digits, errorCode, makeTenant, person, platformAdmin } from "./helpers";

let a: TenantCtx, b: TenantCtx;
let clientA: string, clientB: string, serviceA: string, serviceB: string, collabB: string;
const sharedPib = digits(9);

beforeAll(async () => {
  a = (await makeTenant("Alfa")).admin;
  b = (await makeTenant("Beta")).admin;
  clientA = (await createClient(a, company({ taxNumber: sharedPib }))).id;
  clientB = (await createClient(b, company({ companyName: "TEST Tajna Beta d.o.o." }))).id;
  serviceA = (await createService(a, { name: "Usluga A", description: "", category: "" })).id;
  serviceB = (await createService(b, { name: "Usluga B", description: "", category: "" })).id;
  collabB = (
    await createCollaboration(b, {
      clientId: clientB, serviceId: serviceB, title: "Saradnja B", description: "", startDate: "", plannedEndDate: "",
      status: "in_progress", contractValue: "100", currency: "RSD", responsibleUserId: "", note: "",
    })
  ).id;
});

describe("izolacija na nivou baze (RLS)", () => {
  it("bez konteksta upit ne vidi nijedan red", async () => {
    const r = await withContext({}, (db) => db.query("SELECT id FROM clients"));
    expect(r.rows).toHaveLength(0);
  });

  it("kontekst jedne organizacije ne vidi redove druge, ni uz izričit ID", async () => {
    const all = await withContext({ tenantId: a.tenantId, userId: a.userId }, (db) => db.query("SELECT tenant_id FROM clients"));
    expect(all.rows.length).toBeGreaterThan(0);
    expect(all.rows.every((r) => r.tenant_id === a.tenantId)).toBe(true);
    for (const table of ["clients", "collaborations", "services", "audit_logs", "client_business_details", "tenant_settings"]) {
      const r = await withContext({ tenantId: a.tenantId, userId: a.userId }, (db) =>
        db.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1`, [b.tenantId]),
      );
      expect(r.rows, table).toHaveLength(0);
    }
  });

  it("upis, izmena i brisanje tuđih redova nisu mogući", async () => {
    const asA = { tenantId: a.tenantId, userId: a.userId };
    await expect(
      withContext(asA, (db) =>
        db.query("INSERT INTO clients (tenant_id, type, display_name) VALUES ($1, 'company', 'Podmetnut')", [b.tenantId]),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withContext(asA, (db) => db.query("UPDATE clients SET display_name = 'Izmenjen' WHERE id = $1", [clientB]));
    expect(updated.rowCount).toBe(0);
    const deleted = await withContext(asA, (db) => db.query("DELETE FROM clients WHERE id = $1", [clientB]));
    expect(deleted.rowCount).toBe(0);
    await expect(
      withContext(asA, (db) => db.query("UPDATE clients SET tenant_id = $2 WHERE id = $1", [clientA, b.tenantId])),
    ).rejects.toThrow(/row-level security/);
  });

  it("složeni strani ključevi sprečavaju vezu između organizacija", async () => {
    await expect(
      withContext({ tenantId: a.tenantId, userId: a.userId }, (db) =>
        db.query("INSERT INTO collaborations (tenant_id, client_id, service_id, title) VALUES ($1, $2, $3, 'Unakrsno')", [
          a.tenantId, clientB, serviceA,
        ]),
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      withContext({ tenantId: a.tenantId, userId: a.userId }, (db) =>
        db.query("UPDATE clients SET linked_person_id = $2 WHERE id = $1", [clientA, clientB]),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("evidencija aktivnosti se ne može menjati ni brisati", async () => {
    const asA = { tenantId: a.tenantId, userId: a.userId };
    const upd = await withContext(asA, (db) => db.query("UPDATE audit_logs SET summary = 'x'"));
    expect(upd.rowCount).toBe(0);
    const del = await withContext(asA, (db) => db.query("DELETE FROM audit_logs"));
    expect(del.rowCount).toBe(0);
    expect((await listAudit(a)).total).toBeGreaterThan(0);
  });
});

describe("izolacija kroz aplikacioni sloj (manipulacija identifikatorima)", () => {
  it("čitanje tuđeg klijenta i saradnje daje NOT_FOUND", async () => {
    expect(await errorCode(getClient(a, clientB))).toBe("NOT_FOUND");
    expect(await errorCode(getCollaboration(a, collabB))).toBe("NOT_FOUND");
    expect(await errorCode(revealJmbg({ ...a, perms: { ...a.perms, sensitive: true } }, clientB))).toBe("NOT_FOUND");
  });

  it("izmena tuđih zapisa nije moguća", async () => {
    expect(await errorCode(updateClient(a, clientB, company()))).toBe("NOT_FOUND");
    expect(await errorCode(setClientStatus(a, clientB, "archived"))).toBe("NOT_FOUND");
    expect(await errorCode(setServiceActive(a, serviceB, false))).toBe("NOT_FOUND");
    expect(await errorCode(updateMember(a, b.userId, { role: "user", status: "inactive", canView: true, canCreate: true, canEdit: true, canExport: true, canViewSensitive: false }))).toBe("NOT_FOUND");
    expect((await getClient(b, clientB)).displayName).toBe("TEST Tajna Beta d.o.o.");
  });

  it("saradnja se ne može vezati za tuđeg klijenta, uslugu ili osobu", async () => {
    const base = {
      clientId: clientA, serviceId: serviceA, title: "Pokušaj", description: "", startDate: "", plannedEndDate: "",
      status: "planned", contractValue: "", currency: "RSD", responsibleUserId: "", note: "",
    };
    expect(await errorCode(createCollaboration(a, { ...base, clientId: clientB }))).toBe("VALIDATION");
    expect(await errorCode(createCollaboration(a, { ...base, serviceId: serviceB }))).toBe("VALIDATION");
    expect(await errorCode(createCollaboration(a, { ...base, responsibleUserId: b.userId }))).toBe("VALIDATION");
    expect(await errorCode(createClient(a, person({ responsibleUserId: b.userId })))).toBe("VALIDATION");
    expect(await errorCode(createClient(a, { ...person(), type: "farm", linkedPersonId: clientB }))).toBe("VALIDATION");
  });

  it("liste, pretraga, šifarnici, izveštaji i pokazatelji sadrže samo sopstvene podatke", async () => {
    expect((await listClients(a, { q: "Tajna" })).total).toBe(0);
    expect((await listClients(b, { q: "Tajna" })).total).toBe(1);
    expect(await listCollaborations(a)).toHaveLength(0);
    expect((await listServices(a)).map((s) => s.name)).toEqual(["Usluga A"]);
    expect((await getLookups(a)).members.map((m) => m.id)).toEqual([a.userId]);
    expect((await getDashboard(a)).kpis).toMatchObject({ totalClients: 1, activeCollaborations: 0 });
    expect((await getDashboard(b)).kpis).toMatchObject({ totalClients: 1, activeCollaborations: 1 });
    expect((await runReport(a, "byService")).rows).toHaveLength(0);
    expect((await runReport(a, "total")).total?.clients).toBe(1);
    const audit = await listAudit(a);
    expect(audit.rows.some((r) => r.summary.includes("Beta"))).toBe(false);
  });

  it("isti PIB sme postojati u dve organizacije, ali ne dvaput u istoj", async () => {
    expect(await errorCode(createClient(b, company({ taxNumber: sharedPib })))).toBe("OK");
    expect(await errorCode(createClient(a, company({ taxNumber: sharedPib })))).toBe("CONFLICT");
  });

  it("korisnik ne dobija kontekst organizacije u kojoj nema aktivno članstvo", async () => {
    expect((await loadTenantCtx(a.userId, b.tenantId)).ctx).toBeNull();
    expect((await loadTenantCtx(a.userId, a.tenantId)).ctx?.tenantId).toBe(a.tenantId);
    const member = await addMember(a);
    await updateMember(a, member.userId, { role: "user", status: "inactive", canView: true, canCreate: true, canEdit: true, canExport: false, canViewSensitive: false });
    expect((await loadTenantCtx(member.userId, a.tenantId)).ctx).toBeNull();
  });
});

describe("administrator platforme", () => {
  it("vidi organizacije i naloge, ali ne i poslovne podatke", async () => {
    const admin = await platformAdmin();
    const tenants = await listTenants(admin);
    expect(tenants.map((t) => t.id)).toEqual(expect.arrayContaining([a.tenantId, b.tenantId]));
    for (const table of ["clients", "collaborations", "client_person_details", "services"]) {
      const r = await withContext({ userId: admin, platform: true }, (db) => db.query(`SELECT 1 FROM ${table}`));
      expect(r.rows, table).toHaveLength(0);
    }
    expect((await loadTenantCtx(admin, a.tenantId)).ctx).toBeNull();
  });

  it("običan korisnik ne može upravljati organizacijama", async () => {
    expect(await errorCode(listTenants(a.userId))).toBe("FORBIDDEN");
    expect(await errorCode(setTenantStatus(a.userId, b.tenantId, "inactive"))).toBe("FORBIDDEN");
  });

  it("deaktivirana organizacija gubi pristup, a aktiviranjem ga vraća", async () => {
    const admin = await platformAdmin();
    const { admin: c } = await makeTenant("Gama");
    await setTenantStatus(admin, c.tenantId, "inactive");
    expect((await loadTenantCtx(c.userId, c.tenantId)).ctx).toBeNull();
    await setTenantStatus(admin, c.tenantId, "active");
    expect((await loadTenantCtx(c.userId, c.tenantId)).ctx).not.toBeNull();
  });
});
