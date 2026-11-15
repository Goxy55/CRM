# Postavljanje na hosting

Aplikacija je Node.js server sa PostgreSQL bazom. **Klasičan shared hosting (PHP/cPanel bez Node.js-a) nije dovoljan.** Potrebno je:

- Node.js 22.12+ kao trajan proces,
- PostgreSQL 14+,
- HTTPS (aplikacija u produkciji odbija javni `APP_URL` bez HTTPS-a),
- SMTP nalog za pozivnice i reset lozinke.

Aplikacija nije objavljena ni na jednom produkcionom domenu.

## Promenljive okruženja

| Promenljiva | Obavezna | Opis |
| --- | --- | --- |
| `DATABASE_URL` | da | nalog koji **nije** superuser i nema `BYPASSRLS` |
| `DATABASE_SSL` | po potrebi | `true` za TLS vezu sa bazom |
| `APP_URL` | da | javna HTTPS adresa, bez putanje |
| `BETTER_AUTH_SECRET` | da | `openssl rand -hex 32` |
| `JMBG_ENCRYPTION_KEY`, `JMBG_INDEX_KEY` | da | svaki `openssl rand -hex 32`; čuvati odvojeno od baze |
| `SMTP_URL`, `MAIL_FROM` | preporučeno | bez njih reset lozinke ne radi |

## Koraci (bilo koji Node.js hosting)

```bash
npm ci --include=dev
```

```bash
npm run build
```

```bash
npm run migrate
```

```bash
npm start
```

Zatim jednom napravite administratora platforme (`npm run platform-admin`, vidi README). Provera: `GET /api/healthz` vraća `{"status":"ok"}`.

Migracije pokrećite pri svakoj novoj verziji, pre starta. Demo podatke (`seed:demo`) ne unosite u produkciju.

## Baza

- Nalog aplikacije treba da bude vlasnik baze, ali običan nalog. Na Render-u i sličnim servisima podrazumevani nalog je takav. Na Supabase-u nalog `postgres` ima `BYPASSRLS`; napravite poseban nalog za aplikaciju.
- Za ispravan abecedni redosled (Č, Š, Ž) bazu napravite sa odgovarajućom kolacijom, npr. `CREATE DATABASE crm OWNER crm LOCALE_PROVIDER icu ICU_LOCALE 'sr-Latn' TEMPLATE template0;`
- Podesite automatske rezervne kopije (SECURITY.md).

## Render

`render.yaml` opisuje web servis i bazu u Frankfurtu. Resursi se plaćaju i kreiraju se tek kada ih vlasnik potvrdi u svom Render nalogu; cene proverite na njihovom cenovniku. `JMBG_ENCRYPTION_KEY`, `JMBG_INDEX_KEY`, `SMTP_URL` i `MAIL_FROM` unose se ručno. Za sopstveni domen zamenite `APP_URL` stvarnom adresom. **Ova konfiguracija nije isprobana na stvarnom Render nalogu.**

## Sopstveni server (Docker)

`Dockerfile` gradi sliku koja pri startu primenjuje migracije i pokreće aplikaciju na portu 3000. Ispred nje treba HTTPS proxy (Caddy, Nginx). **Slika nije izgrađena ni pokrenuta u razvojnom okruženju.**

## Više instanci

Podržano: sesije i ograničenje zahteva su u bazi, migracije se zaključavaju. Jedina stvar po instanci je keš prikaza Next.js-a, koji ne sadrži podatke organizacija (sve stranice su dinamičke).

## Provera pre puštanja korisnika

1. `/api/healthz` preko javnog HTTPS domena.
2. Prijava, odjava i reset lozinke (stiže li poruka).
3. Dve probne organizacije: korisnik jedne ne vidi podatke druge.
4. Izvoz u Excel i PDF (srpska slova u PDF-u).
5. Rezervna kopija baze i probni oporavak.
