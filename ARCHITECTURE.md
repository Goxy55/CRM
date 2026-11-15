# Arhitektura

## Tehnologije

| Sloj | Izbor |
| --- | --- |
| Aplikacija | Next.js 16 (App Router), React 19, TypeScript |
| Interfejs | Tailwind CSS 4, sopstvene komponente u duhu shadcn/ui (`src/components/ui.tsx`), lucide ikone |
| Formulari i validacija | React Hook Form + Zod (iste šeme u pregledaču i na serveru) |
| Tabele i grafikoni | TanStack Table, Recharts |
| Baza | PostgreSQL, SQL migracije, `pg` bez ORM-a |
| Prijava | Better Auth (email + lozinka, sesije u bazi) |
| Izvoz | exceljs (XLSX), pdfkit (PDF, font DejaVu Sans zbog č/ć/đ/š/ž) |

### Odstupanja od predloženog okvira

- **Better Auth umesto Supabase Auth.** Supabase projekat nije bio konfigurisan, pa se prijava i izolacija ne bi mogle proveriti. Ovako aplikacija radi na bilo kom PostgreSQL-u (i Supabase-ovom) i sve je pokriveno testovima. RLS je implementiran u samoj bazi, nezavisno od Supabase-a.
- **shadcn/ui komponente nisu preuzete generatorom** (registar nije bio dostupan iz razvojnog okruženja); napisane su ručno, istim pristupom.

## Slojevi

```
src/app/            stranice (server komponente), server akcije, API rute
src/components/     UI komponente; klijentske samo gde je potrebno stanje
src/lib/            domen, Zod šeme i formatiranje — deli ih pregledač i server
src/i18n/           rečnik (srpski); tačka proširenja za druge jezike
src/server/
  db.ts             konekcija i withContext() — jedina putanja do tabela
  context.ts        TenantCtx (ko, u kojoj organizaciji, sa kojim dozvolama)
  session.ts        veza sa Next.js-om: sesija, kolačić organizacije, omotači akcija
  auth.ts           Better Auth, zaključavanje naloga, kreiranje korisnika
  crypto.ts         šifrovanje i otisak JMBG-a, tokeni
  audit.ts          upis u evidenciju aktivnosti
  services/         poslovna logika po modulima
  exports/          XLSX i PDF
migrations/         SQL migracije
scripts/            migrate, platform-admin, seed-demo
tests/, e2e/        integracioni i end-to-end testovi
```

Pravilo: **stranice i akcije ne sadrže poslovnu logiku ni SQL.** One pozivaju servise. Svaki servis prima `TenantCtx`, sam proverava dozvole (`requirePerm`, `requireAdmin`) i radi u transakciji sa kontekstom organizacije. Zato testovi mogu da pozivaju servise direktno, bez Next.js-a.

## Tok zahteva

1. `session.ts` čita sesiju (Better Auth) i kolačić izabrane organizacije.
2. `loadTenantCtx` iz baze učitava **aktivno članstvo u aktivnoj organizaciji**. Identifikator organizacije iz kolačića, URL-a ili formulara nikada sam ne daje pristup.
3. Servis otvara transakciju kroz `withContext`, koja postavlja `app.tenant_id` i `app.user_id`; RLS pravila u bazi propuštaju samo redove te organizacije.
4. Izmena i zapis u `audit_logs` idu u istoj transakciji.

## Ključne odluke

- **Dva sloja izolacije.** Svaki upit ima izričit `tenant_id = $1`, a RLS važi i kada bi upit to zaboravio. Složeni strani ključevi `(tenant_id, id)` onemogućavaju vezu između organizacija.
- **Administrator platforme nema pristup poslovnim podacima.** Za tabele klijenata, saradnji i usluga ne postoji RLS pravilo koje bi mu ih otvorilo.
- **Bez brisanja.** Klijenti se arhiviraju, usluge i šifarnici deaktiviraju, saradnje otkazuju.
- **Novac kao `numeric(14,2)`**, kroz aplikaciju putuje kao tekst — nikada kroz float.
- **Server akcije za izmene** (ugrađena provera porekla zahteva), API rute samo za prijavu, preuzimanje izvoza, logo i proveru zdravlja.
- **Nema middleware-a**: provera pristupa je u serverskom rasporedu i u svakom servisu.

## Tačke proširenja

- Novi modul = migracija (tabela sa `tenant_id`, složeni ključevi, RLS pravilo `tenant_isolation`) + servis + stranice.
- `TenantCtx.perms` i tabela `tenant_memberships`: nove dozvole ili pristup po dodeljenom klijentu.
- `audit()` prima `entityType` i `clientId`, pa novi moduli odmah ulaze u istoriju klijenta.
- Tab „Dokumentacija“ na profilu klijenta je rezervisan za Fazu 2.
- `tenant_settings` za podešavanja po organizaciji; `src/i18n` za jezike.
