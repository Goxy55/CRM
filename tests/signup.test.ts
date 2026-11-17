import { beforeAll, describe, expect, it } from "vitest";
import { findUserIdByEmail } from "@/server/auth";
import { loadTenantCtx, type TenantCtx } from "@/server/context";
import { withContext } from "@/server/db";
import { listAudit } from "@/server/services/dashboard";
import { getLookups } from "@/server/services/lookups";
import {
  approveAccessRequest, countAccessRequests, getSignupLink, getSignupTenant, listAccessRequests,
  pendingOrganizations, rejectAccessRequest, requestAccess, setSignupLink,
} from "@/server/services/signup";
import { inviteUser, listMembers, updateMember } from "@/server/services/users";
import { addMember, errorCode, makeTenant, PASSWORD } from "./helpers";

let a: TenantCtx, b: TenantCtx;
const tokenOf = (link: string) => link.split("/").pop()!;
let n = 0;
const tester = (overrides = {}) => ({
  firstName: "Tester",
  lastName: `Probni${++n}`,
  email: `tester-${Date.now()}-${n}@example.test`,
  password: PASSWORD,
  ...overrides,
});
const grant = { role: "user" as const, canView: true, canCreate: true, canEdit: false, canExport: false, canViewSensitive: false };

beforeAll(async () => {
  a = (await makeTenant("Prijava A")).admin;
  b = (await makeTenant("Prijava B")).admin;
});

describe("link za prijavu", () => {
  it("je podrazumevano isključen; uključuje ga samo administrator", async () => {
    expect(await getSignupLink(a)).toBeNull();
    const member = await addMember(a);
    expect(await errorCode(setSignupLink(member, "enable"))).toBe("FORBIDDEN");
    expect(await errorCode(getSignupLink(member))).toBe("FORBIDDEN");
    const link = await setSignupLink(a, "enable");
    expect(link).toMatch(/^http:\/\/localhost:3999\/registracija\/[A-Za-z0-9_-]{40,}$/);
    expect(await setSignupLink(a, "enable")).toBe(link);
    expect(await getSignupTenant(tokenOf(link!))).toMatchObject({ tenantId: a.tenantId, tenantName: a.tenantName });
  });

  it("novi link poništava stari, a isključen link ne važi", async () => {
    const old = (await getSignupLink(a))!;
    const fresh = (await setSignupLink(a, "regenerate"))!;
    expect(fresh).not.toBe(old);
    expect(await getSignupTenant(tokenOf(old))).toBeNull();
    expect(await errorCode(requestAccess(tokenOf(old), tester()))).toBe("VALIDATION");
    await setSignupLink(a, "disable");
    expect(await getSignupTenant(tokenOf(fresh))).toBeNull();
    expect(await getSignupLink(a)).toBeNull();
    await setSignupLink(a, "enable");
    const log = (await listAudit(a)).rows.map((r) => r.action);
    expect(log).toEqual(expect.arrayContaining(["signup_link.enabled", "signup_link.regenerated", "signup_link.disabled"]));
  });

  it("nepoznat, neispravan ili tuđ link ne otkriva organizaciju", async () => {
    expect(await getSignupTenant("nepostojeci-link-1234567890")).toBeNull();
    expect(await getSignupTenant("'; DROP TABLE tenants;--")).toBeNull();
    const linkB = tokenOf((await setSignupLink(b, "enable"))!);
    expect((await getSignupTenant(linkB))?.tenantId).toBe(b.tenantId);
    // Kontekst linka ne otvara poslovne podatke organizacije.
    const leaked = await withContext({ signupToken: linkB }, (db) => db.query("SELECT 1 FROM clients"));
    expect(leaked.rows).toHaveLength(0);
  });
});

describe("zahtev za pristup", () => {
  it("pravi nalog bez ikakvog pristupa dok administrator ne odobri", async () => {
    const token = tokenOf((await getSignupLink(a))!);
    const input = tester();
    expect(await requestAccess(token, input)).toEqual({ tenantName: a.tenantName });
    const userId = (await findUserIdByEmail(input.email))!;
    expect((await loadTenantCtx(userId)).ctx).toBeNull();
    expect((await loadTenantCtx(userId, a.tenantId)).ctx).toBeNull();
    expect(await pendingOrganizations(userId)).toEqual([a.tenantName]);

    // Zahtev nije član: nema ga u listi korisnika ni u izboru odgovorne osobe.
    expect((await listMembers(a)).some((m) => m.userId === userId)).toBe(false);
    expect((await getLookups(a)).members.some((m) => m.id === userId)).toBe(false);
    expect(await errorCode(updateMember(a, userId, { ...grant, status: "active" }))).toBe("NOT_FOUND");

    expect((await listAccessRequests(a)).map((r) => r.email)).toContain(input.email);
    expect(await countAccessRequests(a)).toBeGreaterThan(0);
    expect(await countAccessRequests(await addMember(a))).toBe(0);
    const mail = (await import("node:fs")).readdirSync(process.env.MAIL_DIR!);
    expect(mail.length).toBeGreaterThan(0);
  });

  it("odobrenje dodeljuje izabranu ulogu i dozvole i ostavlja trag", async () => {
    const token = tokenOf((await getSignupLink(a))!);
    const input = tester();
    await requestAccess(token, input);
    const userId = (await findUserIdByEmail(input.email))!;
    const member = await addMember(a);
    expect(await errorCode(approveAccessRequest(member, userId, grant))).toBe("FORBIDDEN");
    expect(await errorCode(approveAccessRequest(b, userId, grant))).toBe("NOT_FOUND");
    expect(await errorCode(approveAccessRequest(a, userId, { ...grant, role: "vlasnik" }))).toBe("VALIDATION");

    await approveAccessRequest(a, userId, grant);
    const { ctx } = await loadTenantCtx(userId, a.tenantId);
    expect(ctx).toMatchObject({ role: "user", userName: `${input.firstName} ${input.lastName}`, perms: { view: true, create: true, edit: false, export: false, sensitive: false } });
    expect(await errorCode(approveAccessRequest(a, userId, grant))).toBe("NOT_FOUND");
    const log = (await listAudit(a)).rows;
    expect(log.find((r) => r.action === "member.approved")?.summary).toBe(
      `Odobren pristup: ${input.firstName} ${input.lastName} (Korisnik; Pregled podataka, Unos)`,
    );
    expect(log.some((r) => r.action === "member.requested")).toBe(true);
  });

  it("odbijanje uklanja zahtev; nalog ostaje bez pristupa", async () => {
    const token = tokenOf((await getSignupLink(a))!);
    const input = tester();
    await requestAccess(token, input);
    const userId = (await findUserIdByEmail(input.email))!;
    expect(await errorCode(rejectAccessRequest(b, userId))).toBe("NOT_FOUND");
    await rejectAccessRequest(a, userId);
    expect((await listAccessRequests(a)).some((r) => r.userId === userId)).toBe(false);
    expect((await loadTenantCtx(userId, a.tenantId)).ctx).toBeNull();
    expect((await listAudit(a)).rows.some((r) => r.action === "member.rejected")).toBe(true);
    // Aktivno članstvo se ne može obrisati kao zahtev.
    expect(await errorCode(rejectAccessRequest(a, a.userId))).toBe("NOT_FOUND");
  });

  it("ponovljen zahtev, postojeći član i isključen član dobijaju jasnu poruku", async () => {
    const token = tokenOf((await getSignupLink(a))!);
    const input = tester();
    await requestAccess(token, input);
    expect(await errorCode(requestAccess(token, input))).toBe("CONFLICT");
    expect(await errorCode(requestAccess(token, { ...tester(), email: a.email }))).toBe("CONFLICT");
    const inactive = await addMember(a);
    await updateMember(a, inactive.userId, { ...grant, status: "inactive" });
    expect(await errorCode(requestAccess(token, { ...tester(), email: inactive.email }))).toBe("VALIDATION");
    expect(await errorCode(inviteUser(a, { email: input.email, firstName: "X", lastName: "Y", ...grant }))).toBe("CONFLICT");
  });

  it("postojeći nalog mora dokazati lozinku, uz zaključavanje posle više pokušaja", async () => {
    const tokenB = tokenOf((await getSignupLink(b))!);
    const { email } = a;
    const wrong = await requestAccess(tokenB, { ...tester(), email, password: "pogresna-lozinka-1" }).catch((e) => e);
    expect(wrong.code).toBe("VALIDATION");
    expect(wrong.message).toMatch(/postojeću lozinku/);
    // Lozinka postojećeg naloga se ne menja, a zahtev stiže u drugu organizaciju.
    await requestAccess(tokenB, { ...tester(), email, password: PASSWORD });
    expect((await listAccessRequests(b)).map((r) => r.email)).toContain(email);
    expect((await loadTenantCtx(a.userId, a.tenantId)).ctx?.role).toBe("admin");

    const victim = (await makeTenant("Zakljucavanje")).email;
    for (let i = 0; i < 8; i++)
      await requestAccess(tokenB, { ...tester(), email: victim, password: `pogresna-lozinka-${i}` }).catch(() => undefined);
    const locked = await requestAccess(tokenB, { ...tester(), email: victim, password: PASSWORD }).catch((e) => e);
    expect(locked.message).toMatch(/Previše neuspelih pokušaja/);
  });

  it("proverava unos i ograničava broj zahteva", async () => {
    const token = tokenOf((await getSignupLink(a))!);
    expect(await errorCode(requestAccess(token, { ...tester(), password: "kratka" }))).toBe("VALIDATION");
    expect(await errorCode(requestAccess(token, { ...tester(), email: "nije-email" }))).toBe("VALIDATION");
    expect(await errorCode(requestAccess(token, { ...tester(), firstName: "" }))).toBe("VALIDATION");
    const { admin: busy } = await makeTenant("Mnogo zahteva");
    const busyToken = tokenOf((await setSignupLink(busy, "enable"))!);
    for (let i = 0; i < 30; i++) await requestAccess(busyToken, tester());
    const refused = await requestAccess(busyToken, tester()).catch((e) => e);
    expect(refused.message).toMatch(/nije moguće primiti nove zahteve/);
  }, 60000);
});
