import { cookies } from "next/headers";
import { loadTenantCtx } from "@/server/context";
import { AppError } from "@/server/errors";
import { exportReport } from "@/server/services/reports";
import { getSessionUser, TENANT_COOKIE } from "@/server/session";

// Sadržaj zavisi od prijavljenog korisnika; nikada se ne generiše unapred.
export const dynamic = "force-dynamic";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

/** Preuzimanje izveštaja. Dozvolu za izvoz i izolaciju organizacije proverava servis. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Potrebna je prijava." }, { status: 401 });
  const chosen = (await cookies()).get(TENANT_COOKIE)?.value;
  let { ctx } = await loadTenantCtx(user.id, chosen);
  if (!ctx && chosen) ({ ctx } = await loadTenantCtx(user.id));
  if (!ctx) return Response.json({ error: "Nemate pristup organizaciji." }, { status: 403 });
  const q = new URL(request.url).searchParams;
  const format = q.get("format");
  if (format !== "xlsx" && format !== "pdf") return Response.json({ error: "Nepoznat format." }, { status: 400 });
  try {
    const { data, filename } = await exportReport(
      ctx,
      q.get("report") ?? "",
      {
        from: q.get("from") ?? "",
        to: q.get("to") ?? "",
        status: q.get("status") ?? "",
        activityId: q.get("activityId") ?? "",
        responsibleUserId: q.get("responsibleUserId") ?? "",
      },
      format,
    );
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": TYPES[format],
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError)
      return Response.json({ error: e.message }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 422 });
    console.error("Izvoz izveštaja:", e);
    return Response.json({ error: "Došlo je do greške." }, { status: 500 });
  }
}
