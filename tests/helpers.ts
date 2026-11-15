import { randomUUID } from "node:crypto";
import { createUserWithPassword } from "@/server/auth";
import { loadTenantCtx, type TenantCtx } from "@/server/context";
import { withContext } from "@/server/db";
import { emptyClientForm, type ClientFormValues, type InviteInput } from "@/lib/schemas";
import { createTenant } from "@/server/services/tenants";
import { acceptInvitation, inviteUser } from "@/server/services/users";

export const PASSWORD = "Test-lozinka-12345";
const unique = () => randomUUID().slice(0, 8);
const tokenOf = (link: string) => link.split("/").pop()!;

let platformAdminId: string | undefined;

/** Administrator platforme (jedan po test fajlu). */
export async function platformAdmin(): Promise<string> {
  if (platformAdminId) return platformAdminId;
  const email = `platform-${unique()}@example.test`;
  const id = await createUserWithPassword({ email, name: "TEST Platforma", password: PASSWORD });
  await withContext({ userId: id, platform: true }, async (db) => {
    await db.query("INSERT INTO profiles (user_id, first_name, last_name, email) VALUES ($1, 'TEST', 'Platforma', $2)", [id, email]);
    await db.query("INSERT INTO platform_admins (user_id) VALUES ($1)", [id]);
  });
  return (platformAdminId = id);
}

/** Nova organizacija sa administratorom, kroz isti tok kao u aplikaciji (pozivnica). */
export async function makeTenant(name: string): Promise<{ admin: TenantCtx; email: string }> {
  const email = `admin-${unique()}@example.test`;
  const { id, invitation } = await createTenant(await platformAdmin(), {
    name: `TEST ${name} ${unique()}`,
    adminEmail: email,
    adminFirstName: "Admin",
    adminLastName: name,
  });
  await acceptInvitation(tokenOf(invitation.link), PASSWORD);
  return { admin: await ctxFor(email, id), email };
}

export async function ctxFor(email: string, tenantId: string): Promise<TenantCtx> {
  const { findUserIdByEmail } = await import("@/server/auth");
  const userId = await findUserIdByEmail(email);
  const { ctx } = await loadTenantCtx(userId!, tenantId);
  if (!ctx) throw new Error("Nema aktivnog članstva.");
  return ctx;
}

export async function addMember(admin: TenantCtx, overrides: Partial<InviteInput> = {}): Promise<TenantCtx> {
  const email = `user-${unique()}@example.test`;
  const invitation = await inviteUser(admin, {
    email,
    firstName: "Korisnik",
    lastName: unique(),
    role: "user",
    canView: true,
    canCreate: true,
    canEdit: true,
    canExport: false,
    canViewSensitive: false,
    ...overrides,
  });
  await acceptInvitation(tokenOf(invitation.link), PASSWORD);
  return ctxFor(email, admin.tenantId);
}

export const person = (overrides: Partial<ClientFormValues> = {}): ClientFormValues => ({
  ...emptyClientForm,
  type: "person",
  firstName: "Petar",
  lastName: `Test-${unique()}`,
  ...overrides,
});

export const company = (overrides: Partial<ClientFormValues> = {}): ClientFormValues => ({
  ...emptyClientForm,
  type: "company",
  companyName: `TEST Firma ${unique()} d.o.o.`,
  ...overrides,
});

/** Sintetički identifikatori: nasumične cifre zadate dužine. */
export const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

/**
 * Sintetički JMBG sa ispravnom kontrolnom cifrom, ali nemogućim datumom rođenja
 * (dan i mesec 00), pa ne može pripadati stvarnoj osobi.
 */
export function fakeJmbg(): string {
  const body = "0000" + digits(8);
  const d = [...body].map(Number);
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += (7 - i) * (d[i] + d[i + 6]);
  let control = 11 - (sum % 11);
  if (control > 9) control = 0;
  return body + control;
}

export const errorCode = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? `UNEXPECTED: ${(e as Error).message}`;
  }
};
