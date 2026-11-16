import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import type { TenantCtx } from "@/server/context";
import { createClient, setClientStatus } from "@/server/services/clients";
import { createCollaboration } from "@/server/services/collaborations";
import { createService } from "@/server/services/catalog";
import { listAudit } from "@/server/services/dashboard";
import { getLookups } from "@/server/services/lookups";
import { exportReport, REPORT_KEYS, runReport } from "@/server/services/reports";
import { addMember, company, errorCode, makeTenant, person } from "./helpers";

let admin: TenantCtx, member: TenantCtx;
const byLabel = (rows: Record<string, unknown>[]) => Object.fromEntries(rows.map((r) => [r.label, r.clients]));

beforeAll(async () => {
  admin = (await makeTenant("Izveštaji")).admin;
  member = await addMember(admin, { canExport: false });
  const lookups = await getLookups(admin);
  const production = (name: string) => lookups.productions.find((p) => p.name === name)!.id;
  const activity = (name: string) => lookups.activities.find((p) => p.name === name)!.id;
  const accounting = (await createService(admin, { name: "Knjigovodstvo", description: "", category: "" })).id;
  const ipard = (await createService(admin, { name: "IPARD projekti", description: "", category: "" })).id;
  const collaboration = (clientId: string, serviceId: string, status = "in_progress") =>
    createCollaboration(admin, { clientId, serviceId, title: "Saradnja", description: "", startDate: "", plannedEndDate: "", status, contractValue: "", currency: "RSD", responsibleUserId: "", note: "" });

  // Šest klijenata; jedan arhiviran ne ulazi u izveštaje.
  const farm1 = await createClient(admin, { ...person({ firstName: "Čedomir", lastName: "Žikić" }), type: "farm", status: "active", municipality: "Šid", activityId: activity("Poljoprivreda"), firstContactDate: "2026-01-10", responsibleUserId: member.userId, productionIds: [production("Ratarstvo"), production("Stočarstvo")], primaryProductionId: production("Ratarstvo") });
  const farm2 = await createClient(admin, { ...person(), type: "farm", status: "active", municipality: "Šid", activityId: activity("Poljoprivreda"), firstContactDate: "2026-01-20", productionIds: [production("Ratarstvo")] });
  const firm = await createClient(admin, company({ status: "active", municipality: "Ruma", activityId: activity("Trgovina"), firstContactDate: "2026-02-05", responsibleUserId: member.userId }));
  await createClient(admin, person({ status: "potential", firstContactDate: "2026-02-15" }));
  await createClient(admin, person({ status: "contacted", municipality: "Ruma", firstContactDate: "2025-12-01" }));
  const archived = await createClient(admin, company({ municipality: "Šid", firstContactDate: "2026-01-05" }));
  await setClientStatus(admin, archived.id, "archived");

  await collaboration(farm1.id, ipard);
  await collaboration(farm1.id, accounting);
  await collaboration(farm1.id, accounting, "completed");
  await collaboration(farm2.id, ipard);
  await collaboration(firm.id, accounting, "cancelled");
});

describe("izveštaji", () => {
  it("svih osam izveštaja računa iz stvarnih podataka", async () => {
    const total = await runReport(admin, "total");
    expect(byLabel(total.rows)).toEqual({ "Fizičko lice": 2, "Poljoprivredno gazdinstvo": 2, Preduzetnik: 0, "Privredno društvo": 1 });
    expect(total.total?.clients).toBe(5);
    expect(byLabel((await runReport(admin, "byMunicipality")).rows)).toEqual({ Šid: 2, Ruma: 2, "Nije uneto": 1 });
    expect(byLabel((await runReport(admin, "byActivity")).rows)).toEqual({ Poljoprivreda: 2, Trgovina: 1, "Nije uneto": 2 });
    expect(byLabel((await runReport(admin, "newByMonth")).rows)).toEqual({ "2025-12": 1, "2026-01": 2, "2026-02": 2 });
    expect(byLabel((await runReport(admin, "byResponsible")).rows)).toEqual({ [member.userName]: 2, "Nije dodeljeno": 3 });
    const active = await runReport(admin, "activeClients");
    expect(active.rows).toHaveLength(3);
    expect(active.rows.find((r) => r.name === "Čedomir Žikić")).toMatchObject({ name: "Čedomir Žikić", type: "Poljoprivredno gazdinstvo", municipality: "Šid", responsible: member.userName });
  });

  it("klijent sa više proizvodnji je u svakoj kategoriji, ali se jedinstveni broj ne uvećava", async () => {
    const report = await runReport(admin, "byProduction");
    expect(byLabel(report.rows)).toEqual({ Ratarstvo: 2, Stočarstvo: 1 });
    expect(report.total).toEqual({ label: "Jedinstvenih klijenata sa proizvodnjom", clients: 2 });
  });

  it("po uslugama: otkazane saradnje se ne broje, klijent se broji jednom po usluzi", async () => {
    const report = await runReport(admin, "byService");
    expect(report.rows).toEqual([
      { label: "IPARD projekti", clients: 2, collaborations: 2 },
      { label: "Knjigovodstvo", clients: 1, collaborations: 2 },
    ]);
    expect(report.total).toMatchObject({ clients: 2, collaborations: 4 });
  });

  it("period i filteri sužavaju rezultat", async () => {
    expect((await runReport(admin, "total", { from: "2026-01-01", to: "2026-01-31" })).total?.clients).toBe(2);
    expect((await runReport(admin, "total", { from: "2026-02-01" })).total?.clients).toBe(2);
    expect((await runReport(admin, "total", { status: "active" })).total?.clients).toBe(3);
    expect((await runReport(admin, "total", { status: "archived" })).total?.clients).toBe(1);
    expect((await runReport(admin, "byMunicipality", { responsibleUserId: member.userId })).rows).toEqual([{ label: "Ruma", clients: 1 }, { label: "Šid", clients: 1 }]);
    expect(await errorCode(runReport(admin, "total", { from: "2026-03-01", to: "2026-01-01" }))).toBe("VALIDATION");
    expect(await errorCode(runReport(admin, "nepostojeci"))).toBe("VALIDATION");
    expect(await errorCode(runReport(admin, "total", { from: "1'; DROP TABLE clients;--" }))).toBe("VALIDATION");
  });

  it("izvoz u Excel sadrži iste podatke kao izveštaj", async () => {
    const { data, filename } = await exportReport(admin, "byMunicipality", {}, "xlsx");
    expect(filename).toMatch(/^izvestaj-byMunicipality-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(data as unknown as ArrayBuffer);
    const cells: unknown[][] = [];
    book.worksheets[0].eachRow((row) => cells.push((row.values as unknown[]).slice(1)));
    expect(cells[0]).toEqual(["Klijenti po opštinama"]);
    expect(cells[1]).toEqual([admin.tenantName]);
    expect(cells.slice(4)).toEqual([["Opština", "Broj klijenata"], ["Ruma", 2], ["Šid", 2], ["Nije uneto", 1], ["Ukupno", 5]]);
  });

  it("izvoz u PDF daje ispravan dokument za svaki izveštaj", async () => {
    for (const key of REPORT_KEYS) {
      const { data } = await exportReport(admin, key, {}, "pdf");
      expect(data.subarray(0, 5).toString(), key).toBe("%PDF-");
      expect(data.length, key).toBeGreaterThan(5000);
      expect(data.subarray(-6).toString(), key).toContain("%%EOF");
    }
  });

  it("izvoz traži dozvolu i ostavlja trag", async () => {
    expect(await errorCode(exportReport(member, "total", {}, "xlsx"))).toBe("FORBIDDEN");
    expect(await errorCode(runReport(member, "total"))).toBe("OK");
    const log = (await listAudit(admin)).rows.filter((r) => r.action === "report.exported");
    expect(log.length).toBe(REPORT_KEYS.length + 1);
    expect(log.map((r) => r.summary)).toContain("Izvezen izveštaj „Klijenti po opštinama“ (XLSX)");
  });
});
