import { describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth";
import { withContext } from "@/server/db";
import { makeTenant, PASSWORD } from "./helpers";

// Provera porekla zahteva (CSRF) je u biblioteci isključena pod NODE_ENV=test,
// pa se proverava u e2e testu nad produkcionim build-om (e2e/smoke.ts).

const ORIGIN = "http://localhost:3999";
let ipCounter = 0;
/** Svaki zahtev stiže sa druge adrese, kao kod napadača koji menja IP. */
const call = (path: string, body?: unknown, cookie?: string) =>
  getAuth().handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": `203.0.113.${++ipCounter % 250}`,
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

describe("prijava", () => {
  it("ispravna lozinka otvara sesiju i beleži poslednju prijavu", async () => {
    const { admin, email } = await makeTenant("Prijava");
    const res = await call("/sign-in/email", { email, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect(cookie).toContain("session_token");
    expect(res.headers.getSetCookie().join()).toMatch(/HttpOnly/i);
    const session = await (await call("/get-session", undefined, cookie)).json();
    expect(session.user.email).toBe(email);
    const profile = await withContext({ userId: admin.userId }, (db) =>
      db.query("SELECT last_login_at FROM profiles WHERE user_id = $1", [admin.userId]),
    );
    expect(profile.rows[0].last_login_at).toBeInstanceOf(Date);

    const out = await call("/sign-out", {}, cookie);
    expect(out.status).toBe(200);
    expect(await (await call("/get-session", undefined, cookie)).json()).toBeNull();
  });

  it("pogrešna lozinka i nepostojeći nalog se odbijaju", async () => {
    const { email } = await makeTenant("Odbijanje");
    expect((await call("/sign-in/email", { email, password: "pogresna-lozinka-123" })).status).toBe(401);
    expect((await call("/sign-in/email", { email: "nepostoji@example.test", password: PASSWORD })).status).toBe(401);
  });

  it("otvorena registracija je isključena", async () => {
    const res = await call("/sign-up/email", { email: "novi@example.test", password: PASSWORD, name: "Novi" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await (await call("/sign-in/email", { email: "novi@example.test", password: PASSWORD })).status).toBe(401);
  });

  it("nalog se zaključava posle više neuspelih pokušaja sa različitih adresa, i za ispravnu lozinku", async () => {
    const { email } = await makeTenant("Zakljucavanje");
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await call("/sign-in/email", { email, password: `pogresna-lozinka-${i}` })).status);
    expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(statuses[8]).toBe(429);
    expect((await call("/sign-in/email", { email, password: PASSWORD })).status).toBe(429);
  });
});
