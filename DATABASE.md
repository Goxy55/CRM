# Baza podataka

PostgreSQL 14+. Šema je u `migrations/`, primenjuje se sa `npm run migrate` (tabela `schema_migrations`, svaka migracija u transakciji, zaključavanje protiv istovremenog pokretanja). Migracije se mogu bezbedno pokretati više puta.

| Migracija | Sadržaj |
| --- | --- |
| `001_auth.sql` | tabele biblioteke Better Auth i `login_attempts` |
| `002_core.sql` | poslovni model, indeksi, okidači |
| `003_rls.sql` | funkcije konteksta i RLS pravila |
| `004_access_requests.sql` | link za prijavu (`tenant_settings.signup_token`), status članstva `pending`, pravila za zahteve |

## Tabele

**Platforma i nalozi**

- `user`, `session`, `account`, `verification`, `rateLimit` — Better Auth (nalog, sesije, heš lozinke, tokeni).
- `login_attempts` — pokušaji prijave, za zaključavanje naloga.
- `platform_admins` — administratori platforme.
- `profiles` — ime, prezime, email, poslednja prijava.
- `tenants`, `tenant_settings` — organizacija, valuta, logo.
- `tenant_memberships` — članstvo korisnika u organizaciji: uloga, status, dozvole. Jedan korisnik može biti član više organizacija.
- `invitations` — pozivnice (čuva se samo otisak tokena).
- Zahtev za pristup je red u `tenant_memberships` sa statusom `pending` i bez dozvola; odobrenjem postaje `active`, a odbijanjem se briše. Link za prijavu je `tenant_settings.signup_token`.

**Podaci organizacije** (sve imaju `tenant_id`)

- `business_activities`, `production_categories`, `services` — podesivi šifarnici.
- `clients` — osnovni identitet: tip, naziv za prikaz, status, kontakt, adresa, delatnost, odgovorna osoba, `linked_person_id` (fizičko lice iza gazdinstva ili radnje).
- `client_person_details` — ime, prezime, šifrovan JMBG i njegov otisak.
- `client_business_details` — naziv firme, matični broj, PIB.
- `agricultural_holdings` — BPG.
- `client_productions` — veza klijent ↔ vrsta proizvodnje (više po klijentu, najviše jedna primarna).
- `collaborations` — saradnja: klijent, usluga, status, datumi, `contract_value numeric(14,2)`, valuta.
- `audit_logs` — evidencija aktivnosti.

Identitet klijenta je odvojen od njegovih uloga: isti red u `clients` dobija lične, poslovne i/ili poljoprivredne detalje prema tipu, a gazdinstvo se može povezati sa klijentom – fizičkim licem umesto da se lični podaci dupliraju.

## Integritet

- Svaka tabela organizacije ima `UNIQUE (tenant_id, id)`, a strani ključevi su složeni, npr. `(tenant_id, client_id) → clients(tenant_id, id)`. Baza odbija vezu između zapisa različitih organizacija.
- Jedinstveno unutar organizacije: matični broj, PIB, BPG, otisak JMBG-a, nazivi u šifarnicima.
- `CHECK` ograničenja za statuse, tipove, oblik identifikatora (8/9/12 cifara), valutu i nenegativan iznos.
- `phone_digits` je generisana kolona (samo cifre) za poređenje telefona.
- `created_at` / `updated_at` sa okidačem; `audit_logs` ima okidač koji odbija izmenu i brisanje.

## Row Level Security

RLS je uključen i **forsiran** (`FORCE ROW LEVEL SECURITY`) na svim tabelama organizacije, pa važi i za vlasnika tabela. Pravila čitaju kontekst transakcije:

| Podešavanje | Značenje |
| --- | --- |
| `app.tenant_id` | aktivna organizacija |
| `app.user_id` | prijavljeni korisnik |
| `app.platform` | radnja administratora platforme |
| `app.invite_hash` | otisak tokena pozivnice koja se prihvata |
| `app.signup_token` | link za prijavu; otvara samo naziv te organizacije |

Bez konteksta upit ne vidi nijedan red. Poslovne tabele imaju jedno pravilo: `tenant_id = app_tenant_id()`. Superuser i nalozi sa `BYPASSRLS` zaobilaze RLS, pa aplikacija sa takvim nalogom odbija da radi.

## Indeksi

Pretraga i liste: `(tenant_id, status)`, `(tenant_id, updated_at)`, `(tenant_id, lower(display_name))`, opština, email, telefon, odgovorna osoba, delatnost; saradnje po klijentu, statusu i usluzi; evidencija po vremenu i po klijentu. Pretraga po delu teksta koristi `ILIKE`; za veće baze predviđen je `pg_trgm` (ROADMAP).
