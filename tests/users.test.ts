import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { findUserIdByEmail } from "@/server/auth";
import { loadTenantCtx, type TenantCtx } from "@/server/context";
import { listAudit } from "@/server/services/dashboard";
import { createTenant, getLogo, getOrganization, inviteTenantAdmin, setLogo, updateOrganization } from "@/server/services/tenants";
import { acceptInvitation, getInvitation, inviteUser, listInvitations, listMembers, revokeInvitation, updateMember } from "@/server/services/users";
import { addMember, errorCode, makeTenant, PASSWORD, platformAdmin } from "./helpers";

let admin: TenantCtx;
const invite = (email: string, overrides = {}) => ({
  email, firstName: "Nova", lastName: "Osoba", role: "user" as const,
  canView: true, canCreate: true, canEdit: false, canExport: true, canViewSensitive: false, ...overrides,
});
const tokenOf = (link: string) => link.split("/").pop()!;
const full = { role: "user" as const, status: "active" as const, canView: true, canCreate: true, canEdit: true, canExport: false, canViewSensitive: false };

beforeAll(async () => {
  admin = (await makeTenant("Korisnici")).admin;
});

describe("pozivnice i članstvo", () => {
  it("administrator poziva korisnika; pozivnica stiže emailom i nosi zadate dozvole", async () => {
    const email = `pozvan-${Date.now()}@example.test`;
    const result = await inviteUser(admin, invite(email));
    const mail = readdirSync(process.env.MAIL_DIR!).map((f) => JSON.parse(readFileSync(`${process.env.MAIL_DIR}/${f}`, "utf8")));
    expect(mail.find((m) => m.to === email)?.text).toContain(result.link);
    expect((await listInvitations(admin)).map((i) => i.email)).toContain(email);
    expect(await getInvitation(tokenOf(result.link))).toMatchObject({ email, tenantName: admin.tenantName, hasAccount: false });

    expect(await errorCode(acceptInvitation(tokenOf(result.link), "kratka"))).toBe("VALIDATION");
    await acceptInvitation(tokenOf(result.link), PASSWORD);
    const { ctx } = await loadTenantCtx((await findUserIdByEmail(email))!, admin.tenantId);
    expect(ctx).toMatchObject({ role: "user", userName: "Nova Osoba", perms: { view: true, create: true, edit: false, export: true, sensitive: false } });
    expect((await listMembers(admin)).find((m) => m.email === email)).toMatchObject({ role: "user", status: "active", canEdit: false });
    expect(await listInvitations(admin)).toHaveLength(0);
  });

  it("pozivnica važi jednom; povučena ili nepoznata ne važi", async () => {
    const used = await inviteUser(admin, invite(`jednom-${Date.now()}@example.test`));
    await acceptInvitation(tokenOf(used.link), PASSWORD);
    expect(await errorCode(acceptInvitation(tokenOf(used.link), PASSWORD))).toBe("VALIDATION");
    expect(await getInvitation(tokenOf(used.link))).toBeNull();
    const revoked = await inviteUser(admin, invite(`povucena-${Date.now()}@example.test`));
    await revokeInvitation(admin, revoked.id);
    expect(await errorCode(acceptInvitation(tokenOf(revoked.link), PASSWORD))).toBe("VALIDATION");
    expect(await getInvitation("nepostojeci-token")).toBeNull();
    expect(await errorCode(inviteUser(admin, invite(admin.email)))).toBe("CONFLICT");
  });

  it("postojeći nalog može biti član više organizacija, sa zasebnim dozvolama", async () => {
    const other = (await makeTenant("Druga")).admin;
    const result = await inviteUser(other, invite(admin.email, { role: "user", canExport: false }));
    expect((await getInvitation(tokenOf(result.link)))?.hasAccount).toBe(true);
    await acceptInvitation(tokenOf(result.link));
    const { memberships } = await loadTenantCtx(admin.userId);
    expect(memberships.map((m) => m.tenantId).sort()).toEqual([admin.tenantId, other.tenantId].sort());
    expect((await loadTenantCtx(admin.userId, other.tenantId)).ctx).toMatchObject({ role: "user", perms: { export: false } });
    expect((await loadTenantCtx(admin.userId, admin.tenantId)).ctx).toMatchObject({ role: "admin", perms: { export: true } });
  });
});

describe("uloge i dozvole", () => {
  it("administrator menja dozvole; promena važi odmah i beleži se", async () => {
    const member = await addMember(admin);
    expect(member.perms).toMatchObject({ create: true, export: false });
    await updateMember(admin, member.userId, { ...full, canCreate: false, canExport: true });
    expect((await loadTenantCtx(member.userId, admin.tenantId)).ctx?.perms).toMatchObject({ create: false, export: true });
    await updateMember(admin, member.userId, { ...full, role: "admin" });
    expect((await loadTenantCtx(member.userId, admin.tenantId)).ctx?.role).toBe("admin");
    const log = (await listAudit(admin)).rows.filter((r) => r.action === "member.permissions_changed");
    expect(log.map((r) => r.summary).join("\n")).toMatch(/Unos: ne; Izvoz: da/);
    expect(log.map((r) => r.summary).join("\n")).toMatch(/uloga: Administrator/);
  });

  it("običan korisnik ne može upravljati korisnicima", async () => {
    const member = await addMember(admin);
    expect(await errorCode(inviteUser(member, invite("x@example.test")))).toBe("FORBIDDEN");
    expect(await errorCode(listMembers(member))).toBe("FORBIDDEN");
    expect(await errorCode(updateMember(member, member.userId, { ...full, role: "admin" }))).toBe("FORBIDDEN");
    expect(await errorCode(updateOrganization(member, { name: "Preuzeto", defaultCurrency: "EUR" }))).toBe("FORBIDDEN");
  });

  it("organizacija ne može ostati bez aktivnog administratora", async () => {
    const solo = (await makeTenant("Solo")).admin;
    expect(await errorCode(updateMember(solo, solo.userId, { ...full, role: "user" }))).toBe("VALIDATION");
    expect(await errorCode(updateMember(solo, solo.userId, { ...full, role: "admin", status: "inactive" }))).toBe("VALIDATION");
    const second = await addMember(solo, { role: "admin" });
    expect(await errorCode(updateMember(solo, solo.userId, { ...full, role: "user" }))).toBe("OK");
    expect(await errorCode(updateMember(second, second.userId, { ...full, role: "admin", status: "inactive" }))).toBe("VALIDATION");
  });
});

describe("organizacije", () => {
  it("administrator platforme kreira organizaciju i poziva njenog administratora", async () => {
    const platform = await platformAdmin();
    expect(await errorCode(createTenant(platform, { name: "", adminEmail: "x", adminFirstName: "", adminLastName: "" }))).toBe("VALIDATION");
    expect(await errorCode(createTenant(admin.userId, { name: "Neovlašćena", adminEmail: "a@example.test", adminFirstName: "A", adminLastName: "B" }))).toBe("FORBIDDEN");
    const { admin: created } = await makeTenant("Nova organizacija");
    expect(created.role).toBe("admin");
    expect(await getOrganization(created)).toMatchObject({ defaultCurrency: "RSD", hasLogo: false });
    const again = await inviteTenantAdmin(platform, created.tenantId, { adminEmail: `drugi-${Date.now()}@example.test`, adminFirstName: "Drugi", adminLastName: "Admin" });
    await acceptInvitation(tokenOf(again.link), PASSWORD);
    expect((await listMembers(created)).filter((m) => m.role === "admin")).toHaveLength(2);
  });

  it("naziv, valuta i logo organizacije su podesivi; logo mora biti slika", async () => {
    await updateOrganization(admin, { name: "TEST Preimenovana", defaultCurrency: "EUR" });
    expect(await getOrganization(admin)).toMatchObject({ name: "TEST Preimenovana", defaultCurrency: "EUR" });
    const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64)]);
    await setLogo(admin, png);
    expect(await getLogo(admin)).toMatchObject({ mime: "image/png" });
    expect(await errorCode(setLogo(admin, Buffer.from("<svg onload=alert(1)>")))).toBe("VALIDATION");
    expect(await errorCode(setLogo(admin, Buffer.concat([png, Buffer.alloc(300 * 1024)])))).toBe("VALIDATION");
    await setLogo(admin, null);
    expect(await getLogo(admin)).toBeNull();
  });
});
