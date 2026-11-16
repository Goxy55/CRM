import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { getAuth } from "./auth";
import { isPlatformAdmin, loadTenantCtx, type MembershipSummary, type TenantCtx } from "./context";
import { AppError } from "./errors";

export const TENANT_COOKIE = "crm_tenant";

/** Prijavljeni korisnik iz sesijskog kolačića, ili null. Jednom po zahtevu. */
export const getSessionUser = cache(async (): Promise<{ id: string; email: string; name: string } | null> => {
  // headers() pre svega ostalog: time Next zna da stranica zavisi od zahteva.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  return session ? { id: session.user.id, email: session.user.email, name: session.user.name } : null;
});

export type Session = { ctx: TenantCtx; memberships: MembershipSummary[]; platformAdmin: boolean };

/**
 * Kontekst organizacije za tekući zahtev. Izabrana organizacija (kolačić) važi
 * samo ako korisnik u njoj ima aktivno članstvo; inače se uzima prva dostupna.
 */
const resolve = cache(async (): Promise<{ userId: string | null; session: Session | null; platformAdmin: boolean }> => {
  const user = await getSessionUser();
  if (!user) return { userId: null, session: null, platformAdmin: false };
  const chosen = (await cookies()).get(TENANT_COOKIE)?.value;
  const tenantId = chosen && z.uuid().safeParse(chosen).success ? chosen : null;
  let { ctx, memberships } = await loadTenantCtx(user.id, tenantId);
  if (!ctx && tenantId) ({ ctx, memberships } = await loadTenantCtx(user.id));
  const platformAdmin = await isPlatformAdmin(user.id);
  return { userId: user.id, platformAdmin, session: ctx ? { ctx, memberships, platformAdmin } : null };
});

/** Za stranice: bez prijave vodi na prijavu, bez članstva na odgovarajuću stranu. */
export async function requireSession(): Promise<Session> {
  const { userId, session, platformAdmin } = await resolve();
  if (!userId) redirect("/prijava");
  if (!session) redirect(platformAdmin ? "/platforma" : "/bez-pristupa");
  return session;
}

export async function requirePlatformAdmin(): Promise<{ userId: string; hasTenant: boolean }> {
  const { userId, session, platformAdmin } = await resolve();
  if (!userId) redirect("/prijava");
  if (!platformAdmin) redirect("/");
  return { userId, hasTenant: !!session };
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]>; details?: unknown };

function failure(e: unknown): ActionResult<never> {
  if (e instanceof AppError) {
    const isFields = e.code === "VALIDATION" && e.details && typeof e.details === "object";
    return {
      ok: false,
      error: e.message,
      code: e.code,
      fieldErrors: isFields ? (e.details as Record<string, string[]>) : undefined,
      details: e.code === "CONFLICT" ? e.details : undefined,
    };
  }
  console.error("Neočekivana greška u akciji:", e);
  return { ok: false, error: "Došlo je do greške. Pokušajte ponovo.", code: "INTERNAL" };
}

/** Omotač server akcija: proverava prijavu i članstvo, a greške vraća kao rezultat. */
export async function tenantAction<T>(fn: (ctx: TenantCtx) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const { session } = await resolve();
    if (!session) return { ok: false, error: "Sesija je istekla. Prijavite se ponovo.", code: "UNAUTHENTICATED" };
    return { ok: true, data: await fn(session.ctx) };
  } catch (e) {
    return failure(e);
  }
}

export async function platformAction<T>(fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const { userId } = await resolve();
    if (!userId) return { ok: false, error: "Sesija je istekla. Prijavite se ponovo.", code: "UNAUTHENTICATED" };
    return { ok: true, data: await fn(userId) };
  } catch (e) {
    return failure(e);
  }
}

export async function publicAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return failure(e);
  }
}
