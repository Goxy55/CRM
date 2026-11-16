# Probna objava na Render

Daje jedan HTTPS link na kojem testeri koriste CRM. Render nalog treba samo vlasniku. **Ovi koraci nisu isprobani na stvarnom Render nalogu**; ako neki ekran izgleda drugačije, javite prvu poruku o grešci iz Logs.

## Trošak

`render.yaml` traži dva plaćena resursa u Frankfurtu: web servis (plan `starter`) i PostgreSQL (plan `basic-256mb`). Tačan iznos Render prikazuje pre potvrde; ništa se ne kreira dok ga ne potvrdite. Hosting se plaća dok resursi postoje.

## Objavljivanje

1. Na Render-u izaberite **New → Blueprint**, povežite repozitorijum `Goxy55/CRM` i granu na kojoj je `render.yaml`.
2. Pregledajte servis `crm-test` i bazu `crm-test-db`, pa potvrdite. Tajna za sesije i ključevi za JMBG se generišu sami.
3. Sačekajte status **Live**. Migracije baze se primenjuju automatski pre svakog starta.
4. Otvorite dodeljenu adresu `https://…onrender.com/api/healthz`; treba da vrati `{"status":"ok"}`.
5. Napravite administratora platforme. U web servisu otvorite **Shell** i unesite (sa svojim podacima; lozinka najmanje 12 znakova):

   ```bash
   ADMIN_EMAIL=goran.milinkovic@gmail.com ADMIN_PASSWORD='Nektarija310724' ADMIN_FIRST_NAME=Goran ADMIN_LAST_NAME=Milinkovic npm run platform-admin
   ```

6. Prijavite se na dodeljenoj adresi. Na strani **Platforma** kreirajte organizaciju i unesite podatke njenog administratora.
7. Bez SMTP-a pozivnica se ne šalje emailom: link se prikaže na ekranu i prosleđujete ga sami. Administrator organizacije na tom linku postavlja lozinku.

## Posle objave

- **Email:** u **Environment** dodajte `SMTP_URL` i `MAIL_FROM`. Bez njih „Zaboravljena lozinka“ ne radi.
- **Ključevi za JMBG:** `JMBG_ENCRYPTION_KEY` i `JMBG_INDEX_KEY` prepišite na sigurno mesto i ne menjajte ih. Sa drugim ključem upisani JMBG-ovi se više ne mogu pročitati.
- **Sopstveni domen:** u **Settings → Custom Domains** dodajte npr. `crm.fitkoncept.rs`, u DNS-u unesite zapis koji Render prikaže, pa u `render.yaml` zamenite `APP_URL` tom adresom. Prijava radi samo na adresi iz `APP_URL`.
- **Rezervne kopije:** proverite šta plan baze nudi i probajte oporavak pre unosa stvarnih podataka.
- **Probni podaci:** `npm run seed:demo` ne radi u produkciji; probne klijente unesite ručno ili uvozom.

## Pre slanja linka testerima

Napravite dve organizacije i proverite da korisnik jedne ne vidi klijente druge, da izvoz u PDF prikazuje srpska slova i da podaci ostaju posle ponovne objave.
