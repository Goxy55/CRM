# Roadmap

Faza 1 je završena: organizacije, korisnici, klijenti, saradnje, katalog usluga, pretraga, uvoz, izveštaji, evidencija aktivnosti. Sledeće stavke **nisu implementirane**; redosled je predlog.

## Dopune Faze 1 (male)

- Content-Security-Policy sa nonce vrednostima.
- Dvofaktorska prijava (Better Auth ima dodatak).
- Odjava svih sesija korisnika pri deaktivaciji.
- Izdvajanje svih tekstova stranica u rečnik `src/i18n` i drugi jezik.
- `pg_trgm` indeksi i sortiranje na serveru za velike baze klijenata.
- Rotacija ključa za JMBG (zapis već nosi oznaku verzije).
- Izvoz liste klijenata po trenutnim filterima; uvoz saradnji.
- Pristup po dodeljenom klijentu (korisnik vidi samo „svoje“ klijente).

## Faza 2 — moduli

| Modul | Oslonac u postojećoj arhitekturi |
| --- | --- |
| Dokumentacija klijenta | tab „Dokumentacija“ je rezervisan; nova tabela `documents` sa `tenant_id` i skladište datoteka |
| Projekti i konkursi | proširenje saradnje: faze, rokovi, zadaci, podsetnici |
| Fakturisanje i naplata | saradnja već ima ugovorenu vrednost i valutu; nove tabele faktura i uplata |
| Finansijski pregled | izveštaji nad fakturama; konverzija valuta |
| Email obaveštenja i kampanje | `mail.ts` + red poslova |
| Integracije sa registrima (APR, RPG) | servis po izvoru; dopuna podataka klijenta po MB/PIB/BPG |
| Napredna analitika i AI funkcije | nad postojećim podacima i evidencijom |
| Pretplate i naplata platforme | `tenants.status` i `tenant_settings`; plan i ograničenja po organizaciji |
| Zaštita podataka | pravila čuvanja, brisanje i izvoz podataka jednog lica |

## Kako se dodaje modul

1. Migracija: tabela sa `tenant_id`, `UNIQUE (tenant_id, id)`, složeni strani ključevi, RLS pravilo `tenant_isolation`.
2. Servis u `src/server/services/` koji prima `TenantCtx`, proverava dozvole i piše u evidenciju.
3. Testovi, uključujući pokušaj pristupa iz druge organizacije.
4. Stranice i server akcije.
