import "dotenv/config";
import { createUserWithPassword, findUserIdByEmail } from "../src/server/auth";
import { loadTenantCtx, type TenantCtx } from "../src/server/context";
import { closePool, withContext } from "../src/server/db";
import { emptyClientForm } from "../src/lib/schemas";
import { createService } from "../src/server/services/catalog";
import { createClient } from "../src/server/services/clients";
import { createCollaboration } from "../src/server/services/collaborations";
import { getLookups } from "../src/server/services/lookups";
import { createTenant } from "../src/server/services/tenants";
import { acceptInvitation, inviteUser } from "../src/server/services/users";

/**
 * Demonstracioni podaci za razvoj i probu: dve organizacije sa izmišljenim
 * klijentima. Ne pokreće se u produkciji. Svi podaci su sintetički.
 *   DEMO_PASSWORD=... npm run seed:demo
 */
const DEMO_SERVICES = [
  "IPARD projekti", "Nacionalni podsticaji", "Lokalni i pokrajinski konkursi", "Registracija gazdinstava", "Knjigovodstvo",
  "Finansijsko savetovanje", "Bankarski krediti", "Biznis planovi", "Konsalting za malu privredu", "Ostale usluge",
];

const token = (link: string) => link.split("/").pop()!;

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Demo podaci se ne unose u produkciono okruženje.");
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12) throw new Error("Postavite DEMO_PASSWORD (najmanje 12 znakova).");
  if (await findUserIdByEmail("platforma@demo.test")) throw new Error("Demo podaci već postoje u ovoj bazi.");

  const platformId = await createUserWithPassword({ email: "platforma@demo.test", name: "Demo Platforma", password });
  await withContext({ userId: platformId, platform: true }, async (db) => {
    await db.query("INSERT INTO profiles (user_id, first_name, last_name, email) VALUES ($1, 'Demo', 'Platforma', 'platforma@demo.test')", [platformId]);
    await db.query("INSERT INTO platform_admins (user_id) VALUES ($1)", [platformId]);
  });

  async function tenant(name: string, email: string, first: string, last: string): Promise<TenantCtx> {
    const { id, invitation } = await createTenant(platformId, { name, adminEmail: email, adminFirstName: first, adminLastName: last });
    await acceptInvitation(token(invitation.link), password);
    return (await loadTenantCtx((await findUserIdByEmail(email))!, id)).ctx!;
  }
  async function member(admin: TenantCtx, email: string, first: string, last: string, canExport: boolean) {
    const inv = await inviteUser(admin, { email, firstName: first, lastName: last, role: "user", canView: true, canCreate: true, canEdit: true, canExport, canViewSensitive: false });
    await acceptInvitation(token(inv.link), password);
    return (await loadTenantCtx((await findUserIdByEmail(email))!, admin.tenantId)).ctx!;
  }
  const collaboration = (ctx: TenantCtx, clientId: string, serviceId: string, title: string, status: string, value: string, start: string) =>
    createCollaboration(ctx, { clientId, serviceId, title, description: "", startDate: start, plannedEndDate: "", status, contractValue: value, currency: "RSD", responsibleUserId: ctx.userId, note: "" });

  // 1) Konsultantska kuća sa poljoprivrednom specijalizacijom.
  const agro = await tenant("Demo Agro Konsalting", "admin@agro.demo.test", "Marija", "Demić");
  const savetnik = await member(agro, "savetnik@agro.demo.test", "Nikola", "Probić", true);
  const services: Record<string, string> = {};
  for (const name of DEMO_SERVICES) services[name] = (await createService(agro, { name, description: "", category: name.includes("IPARD") || name.includes("podsticaji") || name.includes("konkursi") ? "Podsticaji" : "Poslovne usluge" })).id;
  const lookups = await getLookups(agro);
  const production = (n: string) => lookups.productions.find((p) => p.name === n)!.id;
  const activity = (n: string) => lookups.activities.find((a) => a.name === n)!.id;

  const holder = await createClient(agro, { ...emptyClientForm, type: "person", firstName: "Petar", lastName: "Primerović", phone: "064 000 0101", municipality: "Sremska Mitrovica", city: "Laćarak", status: "active", responsibleUserId: savetnik.userId, firstContactDate: "2026-01-12" });
  const farm = await createClient(agro, { ...emptyClientForm, type: "farm", firstName: "Petar", lastName: "Primerović", bpg: "700000000011", linkedPersonId: holder.id, phone: "064 000 0101", municipality: "Sremska Mitrovica", activityId: activity("Poljoprivreda"), status: "active", responsibleUserId: savetnik.userId, firstContactDate: "2026-01-12", productionIds: [production("Ratarstvo"), production("Stočarstvo")], primaryProductionId: production("Ratarstvo") }, { confirmDuplicates: true });
  const orchard = await createClient(agro, { ...emptyClientForm, type: "farm", firstName: "Jelena", lastName: "Uzorković", bpg: "700000000029", email: "jelena@primer.test", municipality: "Topola", activityId: activity("Poljoprivreda"), status: "negotiation", responsibleUserId: agro.userId, firstContactDate: "2026-02-03", productionIds: [production("Voćarstvo"), production("Pčelarstvo")], primaryProductionId: production("Voćarstvo") });
  const mill = await createClient(agro, { ...emptyClientForm, type: "company", companyName: "Primer Mlin d.o.o.", registrationNumber: "90000017", taxNumber: "900000017", email: "kontakt@primermlin.test", phone: "022 000 111", address: "Industrijska 1", city: "Ruma", municipality: "Ruma", activityId: activity("Proizvodnja"), status: "active", responsibleUserId: agro.userId, firstContactDate: "2025-11-20" });
  await createClient(agro, { ...emptyClientForm, type: "entrepreneur", companyName: "SZR Uzorak", firstName: "Milan", lastName: "Testić", registrationNumber: "90000025", taxNumber: "900000025", municipality: "Šabac", activityId: activity("Usluge"), status: "contacted", responsibleUserId: savetnik.userId, firstContactDate: "2026-03-01" });
  await createClient(agro, { ...emptyClientForm, type: "person", firstName: "Ana", lastName: "Probna", phone: "065 000 0202", municipality: "Šabac", status: "potential", firstContactDate: "2026-03-10" });

  await collaboration(savetnik, farm.id, services["IPARD projekti"], "IPARD – nabavka traktora", "in_progress", "180000", "2026-02-01");
  await collaboration(savetnik, farm.id, services["Registracija gazdinstava"], "Obnova registracije 2026", "completed", "6000", "2026-01-15");
  await collaboration(agro, orchard.id, services["Nacionalni podsticaji"], "Podsticaji za podizanje zasada", "negotiation", "45000", "2026-02-10");
  await collaboration(agro, mill.id, services["Knjigovodstvo"], "Knjigovodstvo 2026", "contracted", "360000", "2026-01-01");
  await collaboration(agro, mill.id, services["Biznis planovi"], "Biznis plan za kredit", "planned", "", "2026-04-01");

  // 2) Knjigovodstvena agencija — nezavisna organizacija sa sopstvenim katalogom.
  const books = await tenant("Demo Knjigovodstvo", "admin@knjige.demo.test", "Stefan", "Ogledić");
  const bookkeeping = (await createService(books, { name: "Vođenje poslovnih knjiga", description: "", category: "Knjigovodstvo" })).id;
  await createService(books, { name: "Obračun zarada", description: "", category: "Knjigovodstvo" });
  const shop = await createClient(books, { ...emptyClientForm, type: "company", companyName: "Primer Trgovina d.o.o.", registrationNumber: "90000033", taxNumber: "900000033", municipality: "Novi Sad", status: "active", responsibleUserId: books.userId, firstContactDate: "2026-01-05" });
  await createClient(books, { ...emptyClientForm, type: "entrepreneur", companyName: "Frizerski salon Uzor", firstName: "Ivana", lastName: "Demović", municipality: "Novi Sad", status: "active", responsibleUserId: books.userId });
  await collaboration(books, shop.id, bookkeeping, "Mesečno knjigovodstvo", "in_progress", "25000", "2026-01-05");

  console.log(`Demo podaci su uneti. Nalozi (lozinka iz DEMO_PASSWORD):
  platforma@demo.test       administrator platforme
  admin@agro.demo.test      administrator, Demo Agro Konsalting
  savetnik@agro.demo.test   korisnik, Demo Agro Konsalting
  admin@knjige.demo.test    administrator, Demo Knjigovodstvo`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closePool);
