import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium, type Page } from "playwright";

/**
 * End-to-end provera nad produkcionim build-om (`npm run build` pre pokretanja).
 * Koristi zasebnu, praznu bazu i isključivo sintetičke podatke.
 *   E2E_DATABASE_URL=postgresql://... npm run test:e2e
 */
const PORT = Number(process.env.E2E_PORT || 3998);
const BASE = `http://localhost:${PORT}`;
const PASSWORD = "E2E-lozinka-12345";
Object.assign(process.env, {
  DATABASE_URL: process.env.E2E_DATABASE_URL || "postgresql://crm:crm-local-dev@127.0.0.1:5544/crm_e2e",
  APP_URL: BASE,
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e!",
  JMBG_ENCRYPTION_KEY: "33".repeat(32),
  JMBG_INDEX_KEY: "44".repeat(32),
});
delete process.env.SMTP_URL;

const steps: string[] = [];
const ok = (name: string) => {
  steps.push(name);
  console.log(`  ✓ ${name}`);
};

async function prepareDatabase() {
  const { pool, closePool, withContext } = await import("../src/server/db");
  const { migrate } = await import("../scripts/migrate");
  const { createUserWithPassword } = await import("../src/server/auth");
  await pool().query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(() => undefined);
  const id = await createUserWithPassword({ email: "platforma@e2e.test", name: "E2E Platforma", password: PASSWORD });
  await withContext({ userId: id, platform: true }, async (db) => {
    await db.query("INSERT INTO profiles (user_id, first_name, last_name, email) VALUES ($1, 'E2E', 'Platforma', 'platforma@e2e.test')", [id]);
    await db.query("INSERT INTO platform_admins (user_id) VALUES ($1)", [id]);
  });
  await closePool();
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/healthz`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server se nije pokrenuo.");
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/prijava`);
  await page.getByLabel("Email adresa").fill(email);
  await page.getByLabel("Lozinka").fill(PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/prijava"));
}

/** Organizaciju kreira administrator platforme; njen administrator aktivira nalog preko pozivnice. */
async function createOrganization(page: Page, name: string, email: string) {
  await page.goto(`${BASE}/platforma`);
  await page.getByLabel("Naziv organizacije").fill(name);
  await page.locator("#new-first").fill("Admin");
  await page.getByLabel("Prezime administratora").fill(name.split(" ").pop()!);
  await page.getByLabel("Email administratora").fill(email);
  await page.getByRole("button", { name: "Kreiraj organizaciju" }).click();
  const link = (await page.locator("p.font-mono").first().textContent())!.trim();
  assert.match(link, /\/pozivnica\//);
  await page.getByRole("row", { name: new RegExp(name) }).waitFor();
  return link;
}

async function acceptInvitation(page: Page, link: string) {
  await page.goto(link);
  await page.getByLabel("Nova lozinka").fill(PASSWORD);
  await page.getByLabel("Ponovite lozinku").fill(PASSWORD);
  await page.getByRole("button", { name: "Aktiviraj nalog" }).click();
  await page.waitForURL(/\/prijava/);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function main() {
  await prepareDatabase();
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    await waitForServer();
    const desktop = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, locale: "sr-Latn-RS" });
    const page = await desktop.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // --- Pristup bez prijave i bezbednosna zaglavlja
    const home = await page.goto(BASE);
    assert.match(page.url(), /\/prijava$/);
    assert.equal(home!.headers()["x-frame-options"], "DENY");
    assert.equal(home!.headers()["x-content-type-options"], "nosniff");
    assert.equal((await fetch(`${BASE}/api/reports/export?report=total&format=xlsx`)).status, 401);
    assert.equal((await fetch(`${BASE}/api/logo`)).status, 401);
    ok("bez prijave nema pristupa stranicama ni izvozu");

    const forged = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://zlonamerni.example", cookie: "x=1" },
      body: JSON.stringify({ email: "platforma@e2e.test", password: PASSWORD }),
    });
    assert.equal(forged.status, 403);
    assert.ok((await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: "x@e2e.test", password: PASSWORD, name: "X" }) })).status >= 400);
    ok("zahtev sa tuđeg porekla i otvorena registracija se odbijaju");

    await page.goto(`${BASE}/prijava`);
    await page.getByLabel("Email adresa").fill("platforma@e2e.test");
    await page.getByLabel("Lozinka").fill("pogresna-lozinka-1");
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await page.getByText("Pogrešna email adresa ili lozinka.").waitFor();
    ok("pogrešna lozinka daje jasnu poruku");

    // --- Platforma: dve organizacije
    await login(page, "platforma@e2e.test");
    assert.match(page.url(), /\/platforma$/);
    const alfaLink = await createOrganization(page, "E2E Alfa", "admin@alfa.e2e.test");
    const betaLink = await createOrganization(page, "E2E Beta", "admin@beta.e2e.test");
    await page.getByRole("button", { name: "Odjavi se" }).click();
    await page.waitForURL(/\/prijava/);
    ok("administrator platforme kreira dve organizacije i dobija pozivnice");

    await acceptInvitation(page, alfaLink);
    await page.goto(alfaLink);
    await page.getByText("Pozivnica nije važeća").waitFor();
    await login(page, "admin@alfa.e2e.test");
    await page.getByRole("heading", { name: "Početna" }).waitFor();
    await page.getByText("Još nema klijenata").waitFor();
    assert.equal(await page.getByRole("link", { name: "Platforma" }).count(), 0);
    ok("pozivnica važi jednom; administrator organizacije se prijavljuje");

    // --- Katalog usluga
    await page.getByRole("link", { name: "Administracija" }).click();
    await page.getByRole("link", { name: "Katalog usluga" }).click();
    for (const name of ["Knjigovodstvo", "IPARD projekti"]) {
      await page.getByRole("button", { name: "Dodaj uslugu" }).click();
      await page.getByLabel("Naziv usluge").fill(name);
      await page.getByRole("button", { name: "Sačuvaj" }).click();
      await page.getByRole("row", { name: new RegExp(name) }).waitFor();
    }
    await page.getByRole("row", { name: /IPARD projekti/ }).getByRole("button", { name: "Deaktiviraj" }).click();
    await page.getByRole("row", { name: /IPARD projekti.*Deaktivirana/ }).waitFor();
    ok("administrator uređuje katalog usluga");

    // --- Klijenti
    await page.goto(`${BASE}/klijenti/novi`);
    await page.getByLabel("Tip klijenta").selectOption("company");
    await page.getByRole("button", { name: "Sačuvaj" }).click();
    await page.getByText("Unesite naziv.").waitFor();
    await page.getByLabel("Naziv firme").fill("E2E Mlin d.o.o.");
    await page.getByLabel("PIB").fill("900000017");
    await page.getByLabel("Telefon").fill("022 555 010");
    await page.getByLabel("Opština").fill("Ruma");
    await page.getByLabel("Status klijenta").selectOption("active");
    await page.getByRole("button", { name: "Sačuvaj" }).click();
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}$/);
    const alfaClientUrl = page.url();
    await page.getByRole("heading", { name: "E2E Mlin d.o.o." }).waitFor();
    ok("validacija formulara i kreiranje klijenta");

    await page.goto(`${BASE}/klijenti/novi`);
    await page.getByLabel("Tip klijenta").selectOption("company");
    await page.getByLabel("Naziv firme").fill("E2E Kopija");
    await page.getByLabel("PIB").fill("900000017");
    await page.getByRole("button", { name: "Sačuvaj" }).click();
    await page.getByText("Klijent sa istim identifikatorom već postoji").first().waitFor();
    await page.getByLabel("PIB").fill("");
    await page.getByLabel("Telefon").fill("022/555-010");
    await page.getByRole("button", { name: "Sačuvaj", exact: true }).click();
    await page.getByText("Mogući duplikati").waitFor();
    await page.getByRole("button", { name: "Ipak sačuvaj" }).click();
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}$/);
    ok("duplikat PIB-a se blokira, isti telefon daje upozorenje uz mogućnost potvrde");

    await page.goto(`${BASE}/klijenti/novi`);
    await page.getByLabel("Tip klijenta").selectOption("farm");
    await page.locator("#firstName").fill("Petar");
    await page.getByLabel("Prezime").fill("Probić");
    await page.getByLabel("Broj poljoprivrednog gazdinstva (BPG)").fill("700000000011");
    await page.getByLabel("Ratarstvo").check();
    await page.getByLabel("Stočarstvo").check();
    await page.getByLabel("Primarna proizvodnja").selectOption({ label: "Stočarstvo" });
    await page.getByRole("button", { name: "Sačuvaj" }).click();
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}$/);
    await page.getByText("Stočarstvo · primarna").waitFor();
    await page.getByText("Ratarstvo", { exact: true }).waitFor();
    ok("gazdinstvo sa više vrsta proizvodnje");

    await page.getByRole("link", { name: "Izmeni" }).click();
    await page.getByLabel("Opština").fill("Šid");
    await page.getByRole("button", { name: "Sačuvaj" }).click();
    await page.waitForURL(/\/klijenti\/[0-9a-f-]{36}$/);
    await page.getByLabel("Promena statusa").selectOption("contacted");
    await page.getByText("Status je promenjen.").waitFor();
    await page.getByRole("link", { name: "Aktivnosti" }).click();
    await page.getByText("Izmenjeni podaci klijenta: opština").waitFor();
    await page.getByText("Status klijenta: Potencijalni → Kontaktiran").waitFor();
    await page.getByRole("link", { name: "Dokumentacija" }).click();
    await page.getByText("Dokumentacija je planirana za narednu fazu").waitFor();
    assert.equal(await page.locator("input[type=file]").count(), 0);
    ok("izmena, promena statusa i istorija aktivnosti; dokumentacija bez lažnih kontrola");

    // --- Saradnje
    await page.goto(`${alfaClientUrl}?tab=saradnje`);
    await page.getByRole("link", { name: "Nova saradnja" }).click();
    assert.equal(await page.getByLabel("Vrsta usluge").locator("option", { hasText: "IPARD" }).count(), 0);
    await page.getByLabel("Vrsta usluge").selectOption({ label: "Knjigovodstvo" });
    await page.getByLabel("Naziv saradnje").fill("Knjigovodstvo 2026");
    await page.getByLabel("Status saradnje").selectOption("in_progress");
    await page.getByLabel("Ugovorena vrednost").fill("360000,50");
    await page.getByRole("button", { name: "Sačuvaj" }).click();
    await page.waitForURL(/tab=saradnje/);
    await page.getByRole("link", { name: "Knjigovodstvo 2026" }).waitFor();
    await page.getByText("360.000,50 RSD").waitFor();
    ok("saradnja vezana za klijenta i aktivnu uslugu, sa tačnim iznosom");

    // --- Početna, pretraga
    await page.goto(BASE);
    await page.getByRole("heading", { name: "Poslednje izmene" }).waitFor();
    const kpi = async (label: string) => (await page.locator("section", { hasText: label }).locator("p").nth(1).textContent())!.trim();
    assert.equal(await kpi("Ukupno klijenata"), "3");
    assert.equal(await kpi("Aktivni klijenti"), "1");
    assert.equal(await kpi("Novi klijenti ovog meseca"), "3");
    assert.equal(await kpi("Aktivne saradnje"), "1");
    await page.screenshot({ path: "docs/screens/pocetna-desktop.png" });
    await page.getByLabel("Pretraga klijenata").fill("900000017");
    await page.getByRole("button", { name: "Pretraži" }).click();
    await page.waitForURL(/\/klijenti\?q=900000017/);
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.goto(`${BASE}/klijenti?q=stočarstvo`);
    await page.getByRole("link", { name: "Petar Probić" }).waitFor();
    await page.getByRole("button", { name: /Klijent/ }).click();
    ok("pokazatelji iz baze i univerzalna pretraga (PIB, vrsta proizvodnje), sortiranje tabele");

    // --- Uvoz
    await page.goto(`${BASE}/klijenti/uvoz`);
    const csv = "Naziv firme;PIB;Ime;Prezime;Opština;Status\nE2E Uvezena d.o.o.;900000025;;;Sombor;Aktivan\n;;Mira;Uvozić;Sombor;\nE2E Duplikat;900000017;;;;\n;;Bez prezimena;;;\n";
    await page.getByLabel("Datoteka").setInputFiles({ name: "klijenti.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Nastavi" }).click();
    await page.getByText("Pronađeno 4 redova i 6 kolona").waitFor();
    await page.getByRole("button", { name: "Proveri podatke" }).click();
    await page.getByText("Pregled pre uvoza").waitFor();
    await page.getByText("PIB: klijent već postoji").waitFor();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Uvezi 2 klijenata" }).click();
    await page.getByText("Uvezeno klijenata: 2").waitFor();
    await page.getByText("Odbijeno redova: 2").waitFor();
    ok("uvoz iz CSV-a: mapiranje, pregled, potvrda i izveštaj o odbijenim redovima");

    // --- Izveštaji i izvoz
    await page.goto(`${BASE}/izvestaji?report=byMunicipality`);
    await page.getByRole("row", { name: /Sombor\s*2/ }).waitFor();
    await page.getByRole("img", { name: /Grafikon/ }).waitFor();
    await page.screenshot({ path: "docs/screens/izvestaji-desktop.png", fullPage: true });
    for (const [format, type, magic] of [["xlsx", "spreadsheetml", "PK"], ["pdf", "application/pdf", "%PDF"]] as const) {
      const res = await page.request.get(`${BASE}/api/reports/export?report=byMunicipality&format=${format}`);
      assert.equal(res.status(), 200);
      assert.ok(res.headers()["content-type"].includes(type));
      assert.ok((await res.body()).subarray(0, 4).toString().startsWith(magic));
    }
    await page.goto(`${BASE}/administracija?tab=aktivnosti`);
    await page.getByText("Izvezen izveštaj „Klijenti po opštinama“ (PDF)").waitFor();
    await page.getByText("Uvoz klijenata: uvezeno 2, odbijeno 2").waitFor();
    ok("izveštaj sa grafikonom, izvoz u Excel i PDF, trag u evidenciji");

    // --- Pozivanje korisnika sa ograničenim dozvolama
    await page.goto(`${BASE}/administracija`);
    await page.locator("#invite-first").fill("Vera");
    await page.getByLabel("Prezime").fill("Pregledić");
    await page.getByLabel("Email").fill("pregled@alfa.e2e.test");
    await page.locator("form", { hasText: "Pošalji pozivnicu" }).getByLabel("Unos").uncheck();
    await page.locator("form", { hasText: "Pošalji pozivnicu" }).getByLabel("Izmena").uncheck();
    await page.getByRole("button", { name: "Pošalji pozivnicu" }).click();
    const viewerLink = (await page.locator("p.font-mono").first().textContent())!.trim();
    const viewerContext = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const viewer = await viewerContext.newPage();
    await acceptInvitation(viewer, viewerLink);
    await login(viewer, "pregled@alfa.e2e.test");
    assert.equal(await viewer.getByRole("link", { name: "Novi klijent" }).count(), 0);
    assert.equal(await viewer.getByRole("link", { name: "Administracija" }).count(), 0);
    await viewer.goto(`${BASE}/administracija`);
    await viewer.waitForURL(/zabranjeno=1/);
    await viewer.goto(`${BASE}/klijenti/novi`);
    await viewer.waitForURL(/zabranjeno=1/);
    await viewer.goto(alfaClientUrl);
    await viewer.getByRole("heading", { name: "E2E Mlin d.o.o." }).waitFor();
    assert.equal(await viewer.getByRole("link", { name: "Izmeni" }).count(), 0);
    assert.equal((await viewer.request.get(`${BASE}/api/reports/export?report=total&format=xlsx`)).status(), 403);
    await viewerContext.close();
    ok("korisnik sa dozvolom samo za pregled ne može da unosi, menja, izvozi ni administrira");

    // --- Samostalna prijava preko linka, uz odobrenje administratora
    await page.goto(`${BASE}/administracija`);
    await page.getByRole("button", { name: "Uključi link za prijavu" }).click();
    const signupLink = (await page.locator("p.font-mono", { hasText: "/registracija/" }).textContent())!.trim();
    const testerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const tester = await testerContext.newPage();
    await tester.goto(signupLink);
    await tester.getByText("E2E Alfa").waitFor();
    assert.ok(await noHorizontalScroll(tester), "vodoravni skrol na prijavi");
    await tester.getByLabel("Ime", { exact: true }).fill("Tea");
    await tester.getByLabel("Prezime").fill("Testerović");
    await tester.getByLabel("Email adresa").fill("tester@e2e.test");
    await tester.getByLabel("Lozinka", { exact: true }).fill(PASSWORD);
    await tester.getByLabel("Ponovite lozinku").fill(PASSWORD);
    await tester.screenshot({ path: "docs/screens/prijava-testera-telefon.png" });
    await tester.getByRole("button", { name: "Pošalji zahtev" }).click();
    await tester.getByText("Zahtev je poslat").waitFor();
    await login(tester, "tester@e2e.test");
    await tester.waitForURL(/\/bez-pristupa/);
    await tester.getByText("Zahtev čeka odobrenje").waitFor();
    await tester.goto(`${BASE}/klijenti`);
    await tester.waitForURL(/\/bez-pristupa/);

    await page.goto(BASE);
    await page.getByText("Jedan zahtev za pristup čeka odobrenje").waitFor();
    await page.getByRole("link", { name: "Pregledaj zahteve" }).click();
    const request = page.locator("li", { hasText: "tester@e2e.test" });
    await request.getByLabel("Izmena").uncheck();
    await page.screenshot({ path: "docs/screens/zahtevi-za-pristup.png" });
    await request.getByRole("button", { name: "Odobri" }).click();
    await page.getByText("Pristup je odobren: Tea Testerović.").waitFor();
    await page.getByRole("row", { name: /Tea Testerović/ }).waitFor();

    await tester.goto(BASE);
    await tester.getByRole("heading", { name: "Početna" }).waitFor();
    await tester.goto(alfaClientUrl);
    await tester.getByRole("heading", { name: "E2E Mlin d.o.o." }).waitFor();
    assert.equal(await tester.getByRole("link", { name: "Izmeni" }).count(), 0);
    await testerContext.close();

    await page.goto(`${BASE}/administracija`);
    await page.getByRole("button", { name: "Isključi link za prijavu" }).click();
    await page.getByRole("button", { name: "Uključi link za prijavu" }).waitFor();
    const closed = await (await browser.newContext()).newPage();
    await closed.goto(signupLink);
    await closed.getByText("Link nije važeći").waitFor();
    await closed.context().close();
    ok("tester se prijavljuje preko linka, čeka odobrenje, dobija dodeljenu ulogu; isključen link ne važi");

    // --- Izolacija: druga organizacija
    const betaContext = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const beta = await betaContext.newPage();
    await acceptInvitation(beta, betaLink);
    await login(beta, "admin@beta.e2e.test");
    await beta.getByText("Još nema klijenata").waitFor();
    // Next šalje zaglavlje pre nego što stranica utvrdi da zapis ne postoji, pa se
    // proverava sadržaj: stranica „nije pronađeno“ i nijedan podatak tuđeg klijenta.
    for (const url of [alfaClientUrl, `${alfaClientUrl}/izmena`, `${alfaClientUrl}?tab=saradnje`, `${alfaClientUrl}?tab=aktivnosti`]) {
      await beta.goto(url);
      await beta.getByText("Stranica nije pronađena").waitFor();
      const html = await beta.content();
      for (const secret of ["E2E Mlin", "900000017", "022 555 010", "Knjigovodstvo 2026"]) assert.ok(!html.includes(secret), `${secret} na ${url}`);
    }
    await beta.goto(`${BASE}/klijenti?q=E2E`);
    await beta.getByText("Nema klijenata koji odgovaraju pretrazi").waitFor();
    await beta.goto(`${BASE}/izvestaji?report=byMunicipality`);
    await beta.getByText("Nema podataka za izabrane filtere").waitFor();
    await beta.goto(`${BASE}/saradnje`);
    await beta.getByText("Još nema saradnji").waitFor();
    await beta.context().addCookies([{ name: "crm_tenant", value: "00000000-0000-4000-8000-000000000000", url: BASE }]);
    await beta.goto(BASE);
    await beta.locator("aside").getByText("E2E Beta").waitFor();
    await betaContext.close();
    ok("druga organizacija ne vidi tuđe klijente ni preko direktnog URL-a, pretrage, izveštaja ili kolačića");

    // --- Telefon
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mobile = await phone.newPage();
    await login(mobile, "admin@alfa.e2e.test");
    for (const path of ["/", "/klijenti", alfaClientUrl.replace(BASE, ""), "/saradnje", "/izvestaji?report=byMunicipality", "/administracija", "/podesavanja", "/klijenti/novi", "/klijenti/uvoz"]) {
      await mobile.goto(BASE + path);
      await mobile.locator("h1").first().waitFor();
      assert.ok(await noHorizontalScroll(mobile), `vodoravni skrol na ${path}`);
    }
    await mobile.goto(BASE);
    await mobile.screenshot({ path: "docs/screens/pocetna-telefon.png" });
    await mobile.getByRole("button", { name: "Meni" }).click();
    await mobile.getByRole("link", { name: "Klijenti" }).click();
    await mobile.waitForURL(/\/klijenti$/);
    await mobile.getByRole("link", { name: "E2E Mlin d.o.o." }).click();
    await mobile.getByRole("heading", { name: "E2E Mlin d.o.o." }).waitFor();
    await mobile.screenshot({ path: "docs/screens/klijent-telefon.png" });
    await phone.close();
    ok("telefon (390 px): sve stranice bez vodoravnog skrola, meni i navigacija rade");

    await page.goto(alfaClientUrl);
    await page.screenshot({ path: "docs/screens/klijent-desktop.png" });
    await page.goto(`${BASE}/podesavanja`);
    await page.getByRole("button", { name: "Odjavi se" }).click();
    await page.waitForURL(/\/prijava/);
    await page.goto(`${BASE}/klijenti`);
    assert.match(page.url(), /\/prijava$/);
    ok("odjava zatvara sesiju");

    assert.deepEqual(errors, [], "greške u pregledaču");
    console.log(`\nE2E: ${steps.length} provera uspešno.`);
  } catch (e) {
    console.error("\nServer log (kraj):\n" + serverLog.slice(-1500));
    throw e;
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
