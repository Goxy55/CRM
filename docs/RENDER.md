# Probna objava na Render

Daje jedan HTTPS link na kojem testeri koriste CRM. Render nalog treba samo vlasniku. **Ovi koraci nisu isprobani na stvarnom Render nalogu**; ako neki ekran izgleda drugačije, javite prvu poruku o grešci iz Logs.

## Trošak

`render.yaml` traži dva plaćena resursa u Frankfurtu: web servis (plan `starter`) i PostgreSQL (plan `basic-256mb`). Tačan iznos Render prikazuje pre potvrde; ništa se ne kreira dok ga ne potvrdite. Hosting se plaća dok resursi postoje.

## Objavljivanje

1. Na Render-u izaberite **New → Blueprint**, povežite repozitorijum `Goxy55/CRM` i granu na kojoj je `render.yaml`.
2. Pregledajte servis `crm-test` i bazu `crm-test-db`, pa potvrdite. Tajna za sesije i ključevi za JMBG se generišu sami.
3. Sačekajte status **Live**. Migracije baze se primenjuju automatski pre svakog starta.
4. Otvorite dodeljenu adresu `https://…onrender.com/api/healthz`; treba da vrati `{"status":"ok"}`.
5. Napravite administratora platforme. U web servisu otvorite **Shell** i unesite komandu sa svojim podacima (lozinka najmanje 12 znakova). **Stvarne podatke unosite samo u Shell, nikada u ovaj fajl ili drugde u repozitorijum** — repozitorijum je javan:

   ```bash
   ADMIN_EMAIL=vi@example.com ADMIN_PASSWORD='vasa-lozinka' ADMIN_FIRST_NAME=Ime ADMIN_LAST_NAME=Prezime npm run platform-admin
   ```

6. Prijavite se na dodeljenoj adresi. Na strani **Platforma** kreirajte organizaciju i unesite podatke njenog administratora.
7. Bez SMTP-a pozivnica se ne šalje emailom: link se prikaže na ekranu i prosleđujete ga sami. Administrator organizacije na tom linku postavlja lozinku.

## Testeri: prijava preko linka

Umesto pojedinačnih pozivnica, testeri mogu sami da se prijave:

1. U **Administracija → Korisnici** kliknite **Uključi link za prijavu** i pošaljite link testerima.
2. Tester na linku unese ime, prezime, email i lozinku. Nalog nastaje, ali bez pristupa podacima.
3. Na početnoj strani videćete obaveštenje o novim zahtevima. U **Administracija → Korisnici** za svaki zahtev izaberite ulogu i dozvole, pa **Odobri** ili **Odbij**.
4. Posle odobrenja tester se prijavljuje svojim emailom i lozinkom.

Adresa testera nije potvrđena emailom, pa odobravajte samo osobe koje poznajete. Kada testiranje završi, link isključite; **Novi link** odmah poništava prethodni.

## Posle objave

- **Email:** u **Environment** dodajte `SMTP_URL` i `MAIL_FROM`. Bez njih „Zaboravljena lozinka“ ne radi.
- **Ključevi za JMBG:** `JMBG_ENCRYPTION_KEY` i `JMBG_INDEX_KEY` prepišite na sigurno mesto i ne menjajte ih. Sa drugim ključem upisani JMBG-ovi se više ne mogu pročitati.
- **Sopstveni domen:** u **Settings → Custom Domains** dodajte npr. `crm.fitkoncept.rs`, u DNS-u unesite zapis koji Render prikaže, pa u `render.yaml` zamenite `APP_URL` tom adresom. Prijava radi samo na adresi iz `APP_URL`.
- **Rezervne kopije:** proverite šta plan baze nudi i probajte oporavak pre unosa stvarnih podataka.
- **Probni podaci:** `npm run seed:demo` ne radi u produkciji; probne klijente unesite ručno ili uvozom.

## Pre slanja linka testerima

Napravite dve organizacije i proverite da korisnik jedne ne vidi klijente druge, da izvoz u PDF prikazuje srpska slova i da podaci ostaju posle ponovne objave.
