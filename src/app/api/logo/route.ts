import { getLogo } from "@/server/services/tenants";
import { getSessionUser, TENANT_COOKIE } from "@/server/session";
import { loadTenantCtx } from "@/server/context";
import { cookies } from "next/headers";

// Sadržaj zavisi od prijavljenog korisnika; nikada se ne generiše unapred.
export const dynamic = "force-dynamic";

/** Logo aktivne organizacije prijavljenog korisnika. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response(null, { status: 401 });
  const chosen = (await cookies()).get(TENANT_COOKIE)?.value;
  let { ctx } = await loadTenantCtx(user.id, chosen);
  if (!ctx && chosen) ({ ctx } = await loadTenantCtx(user.id));
  const logo = ctx ? await getLogo(ctx) : null;
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(logo.data), {
    headers: { "Content-Type": logo.mime, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
