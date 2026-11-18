# Bezbednost

## Izolacija organizacija

1. **Baza:** Row Level Security na svim tabelama organizacije, forsiran i za vlasnika; složeni strani ključevi (vidi DATABASE.md).
2. **Aplikacija:** kontekst organizacije nastaje samo iz aktivnog članstva pročitanog iz baze; svaki upit dodatno filtrira po `tenant_id`.
3. **Testovi:** `tests/isolation.test.ts` i `e2e/smoke.ts` proveravaju dve organizacije — direktne upite, manipulaciju identifikatorima, direktne URL-ove, pretragu, izveštaje, izvoz, uvoz i podmetnut kolačić organizacije.

RLS ovde štiti od grešaka u kodu (zaboravljen filter, pogrešan ID). Ne štiti od potpuno kompromitovanog servera aplikacije, koji sam postavlja kontekst — zato pristup serveru i bazi treba ograničiti.

## Prijava i sesije

- Better Auth: lozinke heširane (scrypt), najmanje 12 znakova; sesijski kolačić `HttpOnly`, `SameSite=Lax`, `Secure` uz HTTPS; sesija traje 7 dana.
- Nema otvorene registracije i niko sam ne može da napravi organizaciju. Nalog nastaje na dva načina:
  - **pozivnicom** (jednokratna, 7 dana, u bazi samo otisak tokena);
  - **linkom za prijavu organizacije**, koji administrator organizacije uključuje (podrazumevano isključen), menja i isključuje. Nalog napravljen preko linka ima članstvo u statusu „na čekanju“ i **ne vidi nijedan podatak** dok ga administrator ne odobri i ne dodeli ulogu i dozvole. Organizacija se određuje isključivo iz linka; broj zahteva je ograničen (30 na sat, 200 na čekanju po organizaciji). Za postojeći nalog forma traži njegovu lozinku, uz isto zaključavanje kao pri prijavi.
- Adresa iz zahteva nije potvrđena emailom: pre odobrenja proverite da li osobu poznajete.
- Zaključavanje naloga posle 8 neuspelih pokušaja u 15 minuta, nezavisno od IP adrese, uz ograničenje broja zahteva po adresi.
- Reset lozinke: link važi jedan sat, poništava ostale sesije; odgovor ne otkriva da li nalog postoji.

## Ovlašćenja

Sve provere su na serveru, u servisima. Uloga i dozvole se čitaju iz baze pri svakom zahtevu, pa promena važi odmah. Administrator platforme upravlja organizacijama, ali ne vidi klijente ni saradnje. Organizacija ne može ostati bez aktivnog administratora.

## Zaštita od uobičajenih napada

- **SQL injection:** isključivo parametrizovani upiti.
- **XSS:** React escapuje sadržaj; nema `dangerouslySetInnerHTML`; logo mora biti PNG/JPEG/WebP (provera sadržaja, SVG odbijen).
- **CSRF:** server akcije i Better Auth proveravaju poreklo zahteva; kolačići su `SameSite=Lax`.
- **Zaglavlja:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS u produkciji.
- **Izvoz u Excel:** tekst koji počinje sa `=`, `+`, `-`, `@` se neutrališe.
- **Uvoz:** ograničenje veličine i broja redova; datoteka se ne čuva; organizacija se nikada ne čita iz datoteke.

Content-Security-Policy nije postavljen (Next.js zahteva nonce za ugrađene skripte); predviđen je u ROADMAP-u.

## JMBG

- Opciono polje. Unos, prikaz, pretragu i uklanjanje sme samo korisnik sa dozvolom „Osetljivi podaci“ — ni administrator je nema podrazumevano.
- Čuva se šifrovan (AES-256-GCM, `JMBG_ENCRYPTION_KEY`). Za duplikate i tačnu pretragu koristi se HMAC-SHA256 otisak (`JMBG_INDEX_KEY`) vezan za organizaciju; otvorena vrednost ne postoji ni u jednom indeksu.
- U interfejsu je maskiran; prikaz pune vrednosti i svaka pretraga po JMBG-u se evidentiraju. Ne pojavljuje se u globalnoj pretrazi, izveštajima, izvozu, uvozu ni u evidenciji aktivnosti.
- **Ključevi se čuvaju odvojeno od baze i njenih kopija.** Gubitak ključa znači trajan gubitak upisanih JMBG-ova. Rotacija ključa nije implementirana (zapis nosi oznaku verzije `v1` radi buduće rotacije).

Da li i po kom osnovu organizacija sme da obrađuje JMBG pravno je pitanje koje ova aplikacija ne rešava.

## Evidencija aktivnosti

Beleži kreiranje i izmenu klijenata i saradnji, promene statusa i odgovorne osobe, promene ovlašćenja, izmene kataloga, uvoz, izvoz i pristup JMBG-u. Zapisi se ne mogu menjati ni brisati (RLS bez pravila za izmenu + okidač). Ne sadrže lozinke ni JMBG.

## Tajne

`BETTER_AUTH_SECRET`, ključevi za JMBG, `DATABASE_URL` i SMTP podaci zadaju se isključivo kroz okruženje. `.env` i `.data/` su van Gita.

## Rezervne kopije i oporavak

Aplikacija ne pravi kopije sama. Preporučeni postupak:

1. Dnevni `pg_dump --format=custom` (ili automatske kopije hosting provajdera), čuvan van servera baze, šifrovano.
2. Ključevi za JMBG i `BETTER_AUTH_SECRET` čuvaju se **odvojeno** od kopija baze.
3. Oporavak se proverava povremeno: `pg_restore --no-owner` u praznu bazu, pa pokretanje aplikacije nad njom.
4. Kopije sadrže lične podatke i heševe lozinki — pristup samo ovlašćenima.

## Priprema za propise o zaštiti podataka

Postoje tehnički preduslovi: arhiviranje umesto brisanja, evidencija pristupa, izvoz po dozvoli, odvojeno šifrovanje JMBG-a. Pravila čuvanja, brisanje na zahtev i izvoz podataka jednog lica nisu implementirani (ROADMAP).
