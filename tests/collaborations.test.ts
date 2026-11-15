import { beforeAll, describe, expect, it } from "vitest";
import type { TenantCtx } from "@/server/context";
import { createClient } from "@/server/services/clients";
import { createCollaboration, getCollaboration, listCollaborations, setCollaborationStatus, updateCollaboration } from "@/server/services/collaborations";
import { createLookup, createService, listServices, setServiceActive, updateLookup, updateService } from "@/server/services/catalog";
import { getDashboard, listAudit } from "@/server/services/dashboard";
import { getLookups } from "@/server/services/lookups";
import type { CollaborationFormValues } from "@/lib/schemas";
import { addMember, company, errorCode, makeTenant } from "./helpers";

let admin: TenantCtx, user: TenantCtx, clientId: string, bookkeeping: string, advisory: string;
const form = (overrides: Partial<CollaborationFormValues> = {}): CollaborationFormValues => ({
  clientId, serviceId: bookkeeping, title: "Knjigovodstvo 2026", description: "", startDate: "2026-01-01",
  plannedEndDate: "2026-12-31", status: "planned", contractValue: "", currency: "RSD", responsibleUserId: "", note: "",
  ...overrides,
});

beforeAll(async () => {
  admin = (await makeTenant("Saradnje")).admin;
  user = await addMember(admin);
  clientId = (await createClient(admin, company({ companyName: "TEST Kompanija Petrović" }))).id;
  bookkeeping = (await createService(admin, { name: "Knjigovodstvo", description: "Mesečno vođenje knjiga", category: "Finansije" })).id;
  advisory = (await createService(admin, { name: "Finansijsko savetovanje", description: "", category: "Finansije" })).id;
});

describe("saradnje", () => {
  it("jedan klijent ima više saradnji sa nezavisnim statusima", async () => {
    await createCollaboration(user, form({ status: "in_progress" }));
    await createCollaboration(user, form({ serviceId: advisory, title: "Finansijsko savetovanje", status: "completed" }));
    await createCollaboration(user, form({ serviceId: advisory, title: "Priprema projekta", status: "contracted" }));
    const list = await listCollaborations(admin, { clientId });
    expect(list.map((k) => `${k.title}: ${k.status}`).sort()).toEqual([
      "Finansijsko savetovanje: completed", "Knjigovodstvo 2026: in_progress", "Priprema projekta: contracted",
    ]);
    expect(list.every((k) => k.clientName === "TEST Kompanija Petrović")).toBe(true);
    expect((await getDashboard(admin)).kpis.activeCollaborations).toBe(2);
    expect(await listCollaborations(admin, { status: "completed" })).toHaveLength(1);
    expect(await listCollaborations(admin, { serviceId: bookkeeping })).toHaveLength(1);
  });

  it("ugovorena vrednost se čuva tačno, sa zarezom ili tačkom", async () => {
    const a = await createCollaboration(user, form({ title: "Tačan iznos", contractValue: "1234567890,45", currency: "EUR" }));
    expect(await getCollaboration(admin, a.id)).toMatchObject({ contractValue: "1234567890.45", currency: "EUR" });
    const b = await createCollaboration(user, form({ title: "Decimalni", contractValue: "0.10" }));
    expect((await getCollaboration(admin, b.id)).contractValue).toBe("0.10");
    expect(await errorCode(createCollaboration(user, form({ contractValue: "12.345" })))).toBe("VALIDATION");
    expect(await errorCode(createCollaboration(user, form({ contractValue: "-5" })))).toBe("VALIDATION");
    expect(await errorCode(createCollaboration(user, form({ currency: "dinar" })))).toBe("VALIDATION");
    expect(await errorCode(createCollaboration(user, form({ startDate: "2026-05-01", plannedEndDate: "2026-04-01" })))).toBe("VALIDATION");
  });

  it("promena statusa i izmena ostavljaju trag u istoriji klijenta", async () => {
    const { id } = await createCollaboration(user, form({ title: "Praćenje statusa" }));
    await setCollaborationStatus(user, id, "negotiation");
    await updateCollaboration(admin, id, form({ title: "Praćenje statusa", status: "contracted", contractValue: "50000", responsibleUserId: user.userId }));
    expect(await getCollaboration(admin, id)).toMatchObject({ status: "contracted", contractValue: "50000.00", responsibleName: user.userName });
    const log = (await listAudit(admin, { clientId })).rows.filter((r) => r.summary.includes("Praćenje statusa"));
    expect(log.map((r) => r.summary)).toEqual(
      expect.arrayContaining([
        "Kreirana saradnja „Praćenje statusa“",
        "Status saradnje „Praćenje statusa“: Planirano → Pregovori",
        "Status saradnje „Praćenje statusa“: Pregovori → Ugovoreno",
        "Izmenjena saradnja „Praćenje statusa“: ugovorena vrednost, odgovorna osoba",
      ]),
    );
    const readOnly = await addMember(admin, { canCreate: false, canEdit: false });
    expect(await errorCode(setCollaborationStatus(readOnly, id, "cancelled"))).toBe("FORBIDDEN");
    expect(await errorCode(createCollaboration(readOnly, form()))).toBe("FORBIDDEN");
  });
});

describe("katalog usluga", () => {
  it("administrator dodaje, menja, deaktivira i ponovo aktivira usluge", async () => {
    const { id } = await createService(admin, { name: "Biznis planovi", description: "", category: "" });
    await updateService(admin, id, { name: "Biznis planovi i studije", description: "Izrada", category: "Konsalting" });
    expect((await listServices(admin)).find((s) => s.id === id)).toMatchObject({ name: "Biznis planovi i studije", category: "Konsalting", active: true });
    expect(await errorCode(createService(admin, { name: "knjigovodstvo", description: "", category: "" }))).toBe("CONFLICT");
    await setServiceActive(admin, id, false);
    expect(await errorCode(createCollaboration(admin, form({ serviceId: id })))).toBe("VALIDATION");
    await setServiceActive(admin, id, true);
    expect(await errorCode(createCollaboration(admin, form({ serviceId: id, title: "Posle aktivacije" })))).toBe("OK");
    const actions = (await listAudit(admin)).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["service.created", "service.updated", "service.deactivated", "service.activated"]));
  });

  it("deaktivacija čuva istoriju: postojeće saradnje ostaju vezane za uslugu", async () => {
    await setServiceActive(admin, bookkeeping, false);
    const existing = await listCollaborations(admin, { serviceId: bookkeeping });
    expect(existing.length).toBeGreaterThan(0);
    expect(existing[0].serviceName).toBe("Knjigovodstvo");
    expect((await listServices(admin)).find((s) => s.id === bookkeeping)).toMatchObject({ active: false, collaborations: existing.length });
    expect(await errorCode(updateCollaboration(admin, existing[0].id, form({ title: existing[0].title, status: "completed" })))).toBe("OK");
    await setServiceActive(admin, bookkeeping, true);
  });

  it("katalog i šifarnike menja samo administrator", async () => {
    expect(await errorCode(createService(user, { name: "Neovlašćeno", description: "", category: "" }))).toBe("FORBIDDEN");
    expect(await errorCode(setServiceActive(user, bookkeeping, false))).toBe("FORBIDDEN");
    expect(await errorCode(createLookup(user, "activity", { name: "Neovlašćeno" }))).toBe("FORBIDDEN");
    const { id } = await createLookup(admin, "production", { name: "Gljivarstvo" });
    await updateLookup(admin, "production", id, { name: "Proizvodnja gljiva" });
    await updateLookup(admin, "production", id, { active: false });
    expect((await getLookups(admin)).productions.find((p) => p.id === id)).toMatchObject({ name: "Proizvodnja gljiva", active: false });
    expect(await errorCode(createLookup(admin, "production", { name: "ratarstvo" }))).toBe("CONFLICT");
  });
});
