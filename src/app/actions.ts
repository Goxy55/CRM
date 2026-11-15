"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { ClientStatus, CollaborationStatus } from "@/lib/domain";
import { CLIENT_STATUSES, COLLABORATION_STATUSES } from "@/lib/domain";
import { invalid } from "@/server/errors";
import { createLookup, createService, setServiceActive, updateLookup, updateService, type LookupKind } from "@/server/services/catalog";
import { createClient, revealJmbg, setClientStatus, updateClient } from "@/server/services/clients";
import { createCollaboration, setCollaborationStatus, updateCollaboration } from "@/server/services/collaborations";
import { commitImport, parseImportFile, previewImport, suggestMapping, type ImportMapping } from "@/server/services/import";
import { createTenant, inviteTenantAdmin, setLogo, setTenantStatus, updateOrganization } from "@/server/services/tenants";
import { acceptInvitation, inviteUser, revokeInvitation, updateMember } from "@/server/services/users";
import { loadTenantCtx } from "@/server/context";
import { getSessionUser, platformAction, publicAction, tenantAction, TENANT_COOKIE } from "@/server/session";

/**
 * Server akcije: tanak sloj između formulara i servisa. Ovlašćenja i pravila
 * proveravaju servisi; ovde se samo osvežava prikaz posle izmene.
 */
const refresh = () => revalidatePath("/", "layout");

export const saveClientAction = async (id: string | null, values: unknown, confirmDuplicates: boolean) =>
  tenantAction(async (ctx) => {
    const result = id
      ? await updateClient(ctx, id, values, { confirmDuplicates })
      : await createClient(ctx, values, { confirmDuplicates });
    refresh();
    return result;
  });

export const setClientStatusAction = async (id: string, status: string) =>
  tenantAction(async (ctx) => {
    if (!CLIENT_STATUSES.includes(status as ClientStatus)) throw invalid("Nepoznat status.");
    await setClientStatus(ctx, id, status as ClientStatus);
    refresh();
  });

export const revealJmbgAction = async (id: string) => tenantAction((ctx) => revealJmbg(ctx, id));

export const saveCollaborationAction = async (id: string | null, values: unknown) =>
  tenantAction(async (ctx) => {
    const result = id ? await updateCollaboration(ctx, id, values) : await createCollaboration(ctx, values);
    refresh();
    return result;
  });

export const setCollaborationStatusAction = async (id: string, status: string) =>
  tenantAction(async (ctx) => {
    if (!COLLABORATION_STATUSES.includes(status as CollaborationStatus)) throw invalid("Nepoznat status.");
    await setCollaborationStatus(ctx, id, status as CollaborationStatus);
    refresh();
  });

export const saveServiceAction = async (id: string | null, values: unknown) =>
  tenantAction(async (ctx) => {
    if (id) await updateService(ctx, id, values);
    else await createService(ctx, values);
    refresh();
  });

export const setServiceActiveAction = async (id: string, active: boolean) =>
  tenantAction(async (ctx) => {
    await setServiceActive(ctx, id, active);
    refresh();
  });

export const saveLookupAction = async (kind: LookupKind, id: string | null, change: { name?: string; active?: boolean }) =>
  tenantAction(async (ctx) => {
    if (id) await updateLookup(ctx, kind, id, change);
    else await createLookup(ctx, kind, change);
    refresh();
  });

export const inviteUserAction = async (values: unknown) =>
  tenantAction(async (ctx) => {
    const result = await inviteUser(ctx, values);
    refresh();
    return { link: result.link, mailed: result.mailed };
  });

export const revokeInvitationAction = async (id: string) =>
  tenantAction(async (ctx) => {
    await revokeInvitation(ctx, id);
    refresh();
  });

export const updateMemberAction = async (userId: string, values: unknown) =>
  tenantAction(async (ctx) => {
    await updateMember(ctx, userId, values);
    refresh();
  });

export const updateOrganizationAction = async (values: unknown) =>
  tenantAction(async (ctx) => {
    await updateOrganization(ctx, values);
    refresh();
  });

export const setLogoAction = async (form: FormData | null) =>
  tenantAction(async (ctx) => {
    const file = form?.get("logo");
    if (form && !(file instanceof File)) throw invalid("Izaberite sliku.");
    await setLogo(ctx, file instanceof File ? Buffer.from(await file.arrayBuffer()) : null);
    refresh();
  });

/** Promena aktivne organizacije; važi samo za organizacije sa aktivnim članstvom. */
export const switchTenantAction = async (tenantId: string) =>
  publicAction(async () => {
    const user = await getSessionUser();
    const { ctx } = user ? await loadTenantCtx(user.id, tenantId) : { ctx: null };
    if (!ctx) throw invalid("Nemate pristup izabranoj organizaciji.");
    (await cookies()).set(TENANT_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    refresh();
  });

export const parseImportAction = async (form: FormData) =>
  tenantAction(async (ctx) => {
    if (!ctx.perms.create) throw invalid("Nemate dozvolu za unos podataka.");
    const file = form.get("file");
    if (!(file instanceof File)) throw invalid("Izaberite datoteku.");
    const parsed = await parseImportFile(file.name, Buffer.from(await file.arrayBuffer()));
    return { ...parsed, mapping: suggestMapping(parsed.columns) };
  });

export const previewImportAction = async (mapping: ImportMapping, rows: string[][]) =>
  tenantAction((ctx) => previewImport(ctx, mapping, rows));

export const commitImportAction = async (mapping: ImportMapping, rows: string[][], includeWarnings: boolean) =>
  tenantAction(async (ctx) => {
    const report = await commitImport(ctx, mapping, rows, { includeWarnings });
    refresh();
    return report;
  });

export const createTenantAction = async (values: unknown) =>
  platformAction(async (userId) => {
    const result = await createTenant(userId, values);
    refresh();
    return { link: result.invitation.link, mailed: result.invitation.mailed };
  });

export const setTenantStatusAction = async (tenantId: string, status: "active" | "inactive") =>
  platformAction(async (userId) => {
    await setTenantStatus(userId, tenantId, status);
    refresh();
  });

export const inviteTenantAdminAction = async (tenantId: string, values: unknown) =>
  platformAction(async (userId) => {
    const result = await inviteTenantAdmin(userId, tenantId, values);
    refresh();
    return { link: result.link, mailed: result.mailed };
  });

export const acceptInvitationAction = async (token: string, password?: string) =>
  publicAction(() => acceptInvitation(token, password));
