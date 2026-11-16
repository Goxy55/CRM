import { pool } from "@/server/db";

export const dynamic = "force-dynamic";

/** Provera dostupnosti aplikacije i baze; ne otkriva nikakve podatke. */
export async function GET() {
  try {
    await pool().query("SELECT 1");
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
