# CRM platforma

Univerzalna CRM veb-aplikacija za više nezavisnih organizacija (multi-tenant): evidencija klijenata, saradnji, korisnika i osnovni izveštaji. Interfejs je na srpskom (latinica). Ovo je **Faza 1**.

## Šta aplikacija radi

- **Organizacije** — jedna instalacija, više organizacija; podaci su izolovani u bazi (Row Level Security) i u aplikaciji.
- **Korisnici** — prijava, odjava, promena i reset lozinke, pozivnice, samostalna prijava preko linka organizacije uz odobrenje administratora, deaktivacija, uloge (administrator platforme, administrator organizacije, korisnik) i dozvole: pregled, unos, izmena, izvoz, osetljivi podaci.
- **Klijenti** — fizičko lice, poljoprivredno gazdinstvo, preduzetnik, privredno društvo; više vrsta proizvodnje po klijentu; veza gazdinstva/radnje sa fizičkim licem; statusi; kontrola duplikata; šifrovan JMBG.
- **Saradnje** — neograničen broj po klijentu, vezane za uslugu iz kataloga organizacije, sa statusom i ugovorenom vrednošću.
- **Katalog usluga i šifarnici** — uređuje ih administrator organizacije; stavke se deaktiviraju, ne brišu.
- **Pretraga i filteri**, **uvoz iz Excela/CSV-a**, **osam izveštaja** sa izvozom u Excel i PDF, **evidencija aktivnosti**.

## Lokalno pokretanje

Potrebni su Node.js 22.12+ i PostgreSQL 14+.

```bash
npm ci
```

Napravite bazu i **običan** nalog (ne superuser — aplikacija ga odbija jer zaobilazi RLS):

```sql
CREATE ROLE crm LOGIN PASSWORD 'izaberite-lozinku';
CREATE DATABASE crm OWNER crm;
```

```bash
cp .env.example .env
```

U `.env` upišite `DATABASE_URL`. U razvoju se tajna za sesije i ključevi za JMBG, ako nisu zadati, generišu u `.data/dev-secrets.json` (van Gita).

```bash
npm run migrate
```

```bash
npm run dev
```

Aplikacija je na http://localhost:3000. Prvi nalog (administrator platforme) pravi se iz komandne linije; lozinka se zadaje kroz okruženje:

```bash
ADMIN_EMAIL=vi@example.com ADMIN_PASSWORD='najmanje-12-znakova' ADMIN_FIRST_NAME=Ime ADMIN_LAST_NAME=Prezime npm run platform-admin
```

Prijavite se, na strani **Platforma** kreirajte organizaciju i pozovite njenog administratora. Bez podešenog SMTP-a pozivnice i poruke za reset lozinke se u razvoju upisuju u `.data/mail/`, a link pozivnice se prikazuje i administratoru na ekranu.

### Demonstracioni podaci (samo razvoj)

```bash
DEMO_PASSWORD='najmanje-12-znakova' npm run seed:demo
```

Unosi dve organizacije sa izmišljenim klijentima i ispisuje naloge. Skripta odbija rad kada je `NODE_ENV=production`.

## Testovi

| Komanda | Šta proverava |
| --- | --- |
| `npm run typecheck` | tipove |
| `npm test` | 65 integracionih testova servisa nad pravim PostgreSQL-om (`TEST_DATABASE_URL`), uključujući izolaciju dve organizacije |
| `npm run build && npm run test:e2e` | 19 provera u pregledaču nad produkcionim build-om (`E2E_DATABASE_URL`), uključujući telefon |

Obe baze za testove se pri svakom pokretanju **brišu i prave iznova** — nikada ne usmeravajte ove promenljive na bazu sa stvarnim podacima.

## Dokumentacija

- [ARCHITECTURE.md](ARCHITECTURE.md) — struktura, slojevi, ključne odluke
- [DATABASE.md](DATABASE.md) — model podataka i migracije
- [SECURITY.md](SECURITY.md) — bezbednosni model, JMBG, rezervne kopije
- [DEPLOYMENT.md](DEPLOYMENT.md) — postavljanje na hosting
- [ROADMAP.md](ROADMAP.md) — naredne faze i tačke proširenja

## Poznata ograničenja

- Slanje pošte (pozivnice, reset lozinke) zahteva SMTP; bez njega u produkciji reset lozinke ne radi, a link pozivnice administrator prosleđuje sam.
- Tabele sortiraju redove učitane strane (50 po strani); filtriranje i straničenje rade na serveru.
- Abecedni redosled zavisi od kolacije baze: sa podrazumevanom kolacijom slova Č, Š, Ž dolaze posle Z (vidi DEPLOYMENT.md).
- JMBG se ne uvozi iz datoteka; unosi se pojedinačno, uz posebnu dozvolu.
- Tekstovi stranica su u komponentama; samo nazivi statusa, tipova, uloga i navigacije su u rečniku (`src/i18n`).
- Nema dvofaktorske prijave, promene email adrese naloga ni samostalnog brisanja naloga.
- `Dockerfile` i `render.yaml` nisu isprobani na stvarnoj infrastrukturi.
- Deaktiviran korisnik gubi pristup podacima odmah, ali mu sesija formalno traje do isteka (vidi stranu „Nema pristupa“).
