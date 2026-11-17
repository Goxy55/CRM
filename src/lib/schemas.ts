import { z } from "zod";
import {
  CLIENT_STATUSES,
  CLIENT_TYPES,
  COLLABORATION_STATUSES,
  hasBusiness,
  hasPersonName,
  isValidJmbg,
} from "./domain";

/**
 * Šeme formulara. Polja su tekst kakav stiže iz formulara; ista šema važi u
 * pregledaču i na serveru, a `normalize*` funkcije prave zapis za bazu.
 */
const text = (max: number) => z.string().trim().max(max, `Najviše ${max} znakova.`);
const uuidOrEmpty = z.string().refine((v) => v === "" || z.uuid().safeParse(v).success, "Neispravan izbor.");
const dateOrEmpty = z
  .string()
  .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))), "Neispravan datum.");
const digits = (n: number, name: string) =>
  z.string().trim().refine((v) => v === "" || new RegExp(`^\\d{${n}}$`).test(v), `${name} ima tačno ${n} cifara.`);

export const clientFormSchema = z
  .object({
    type: z.enum(CLIENT_TYPES),
    status: z.enum(CLIENT_STATUSES),
    firstName: text(80),
    lastName: text(80),
    companyName: text(200),
    jmbg: z.string().trim().refine((v) => v === "" || isValidJmbg(v), "JMBG nije ispravan."),
    removeJmbg: z.boolean(),
    registrationNumber: digits(8, "Matični broj"),
    taxNumber: digits(9, "PIB"),
    bpg: digits(12, "BPG"),
    phone: text(40),
    email: z.string().trim().max(200).refine((v) => v === "" || z.email().safeParse(v).success, "Neispravna email adresa."),
    address: text(200),
    city: text(100),
    municipality: text(100),
    activityId: uuidOrEmpty,
    responsibleUserId: z.string().max(100),
    linkedPersonId: uuidOrEmpty,
    firstContactDate: dateOrEmpty,
    note: text(4000),
    agricultural: z.boolean(),
    productionIds: z.array(z.uuid()).max(50),
    primaryProductionId: uuidOrEmpty,
  })
  .superRefine((v, ctx) => {
    const need = (path: keyof typeof v, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (hasBusiness(v.type)) {
      if (!v.companyName) need("companyName", "Unesite naziv.");
    } else {
      if (!v.firstName) need("firstName", "Unesite ime.");
      if (!v.lastName) need("lastName", "Unesite prezime.");
    }
    if (v.type === "entrepreneur" && !!v.firstName !== !!v.lastName)
      need(v.firstName ? "lastName" : "firstName", "Unesite i ime i prezime, ili ostavite oba prazna.");
    if (v.primaryProductionId && !v.productionIds.includes(v.primaryProductionId))
      need("primaryProductionId", "Primarna proizvodnja mora biti među izabranim.");
  });

export type ClientFormValues = z.infer<typeof clientFormSchema>;

export const emptyClientForm: ClientFormValues = {
  type: "person",
  status: "potential",
  firstName: "",
  lastName: "",
  companyName: "",
  jmbg: "",
  removeJmbg: false,
  registrationNumber: "",
  taxNumber: "",
  bpg: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  municipality: "",
  activityId: "",
  responsibleUserId: "",
  linkedPersonId: "",
  firstContactDate: "",
  note: "",
  agricultural: false,
  productionIds: [],
  primaryProductionId: "",
};

const nil = (v: string) => (v === "" ? null : v);

export type ClientInput = ReturnType<typeof normalizeClient>;

/** Zapis za bazu: prazno postaje NULL, a polja koja ne pripadaju tipu se odbacuju. */
export function normalizeClient(v: ClientFormValues) {
  const person = hasPersonName(v.type) && !!v.firstName && !!v.lastName;
  const business = hasBusiness(v.type);
  const agricultural = v.type === "farm" || v.agricultural;
  const productionIds = agricultural ? [...new Set(v.productionIds)] : [];
  return {
    type: v.type,
    status: v.status,
    firstName: person ? v.firstName : null,
    lastName: person ? v.lastName : null,
    companyName: business ? v.companyName : null,
    displayName: business ? v.companyName : `${v.firstName} ${v.lastName}`.trim(),
    // undefined = bez promene; null = ukloni; tekst = nova vrednost.
    jmbg: !person || v.removeJmbg ? null : v.jmbg ? v.jmbg : undefined,
    registrationNumber: business ? nil(v.registrationNumber) : null,
    taxNumber: business ? nil(v.taxNumber) : null,
    bpg: agricultural ? nil(v.bpg) : null,
    phone: nil(v.phone),
    email: v.email ? v.email.toLowerCase() : null,
    address: nil(v.address),
    city: nil(v.city),
    municipality: nil(v.municipality),
    activityId: nil(v.activityId),
    responsibleUserId: nil(v.responsibleUserId),
    linkedPersonId: v.type === "farm" || v.type === "entrepreneur" ? nil(v.linkedPersonId) : null,
    firstContactDate: nil(v.firstContactDate),
    note: nil(v.note),
    productionIds,
    primaryProductionId:
      v.primaryProductionId && productionIds.includes(v.primaryProductionId) ? v.primaryProductionId : null,
  };
}

export const collaborationFormSchema = z
  .object({
    clientId: z.uuid("Izaberite klijenta."),
    serviceId: z.uuid("Izaberite uslugu."),
    title: text(200).min(1, "Unesite naziv saradnje."),
    description: text(2000),
    startDate: dateOrEmpty,
    plannedEndDate: dateOrEmpty,
    status: z.enum(COLLABORATION_STATUSES),
    contractValue: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{1,12}([.,]\d{1,2})?$/.test(v), "Unesite iznos, najviše dve decimale."),
    currency: z.string().regex(/^[A-Z]{3}$/, "Valuta je troslovna oznaka (npr. RSD)."),
    responsibleUserId: z.string().max(100),
    note: text(4000),
  })
  .refine((v) => !v.startDate || !v.plannedEndDate || v.plannedEndDate >= v.startDate, {
    path: ["plannedEndDate"],
    message: "Planirani završetak ne može biti pre početka.",
  });

export type CollaborationFormValues = z.infer<typeof collaborationFormSchema>;

export function normalizeCollaboration(v: CollaborationFormValues) {
  return {
    clientId: v.clientId,
    serviceId: v.serviceId,
    title: v.title,
    description: nil(v.description),
    startDate: nil(v.startDate),
    plannedEndDate: nil(v.plannedEndDate),
    status: v.status,
    // Iznos ostaje tekst sve do baze (numeric), bez prolaska kroz float.
    contractValue: v.contractValue ? v.contractValue.replace(",", ".") : null,
    currency: v.currency,
    responsibleUserId: nil(v.responsibleUserId),
    note: nil(v.note),
  };
}
export type CollaborationInput = ReturnType<typeof normalizeCollaboration>;

export const serviceFormSchema = z.object({
  name: text(160).min(1, "Unesite naziv usluge."),
  description: text(1000),
  category: text(120),
});

export const lookupNameSchema = z.object({ name: text(120).min(1, "Unesite naziv.") });

export const inviteFormSchema = z.object({
  email: z.email("Neispravna email adresa.").max(200),
  firstName: text(80).min(1, "Unesite ime."),
  lastName: text(80).min(1, "Unesite prezime."),
  role: z.enum(["admin", "user"]),
  canView: z.boolean(),
  canCreate: z.boolean(),
  canEdit: z.boolean(),
  canExport: z.boolean(),
  canViewSensitive: z.boolean(),
});
export type InviteInput = z.infer<typeof inviteFormSchema>;

export const memberUpdateSchema = inviteFormSchema
  .omit({ email: true, firstName: true, lastName: true })
  .extend({ status: z.enum(["active", "inactive"]) });
export type MemberUpdate = z.infer<typeof memberUpdateSchema>;

export const signupFormSchema = z.object({
  firstName: text(80).min(1, "Unesite ime."),
  lastName: text(80).min(1, "Unesite prezime."),
  email: z.email("Neispravna email adresa.").max(200),
  password: z
    .string()
    .min(12, "Lozinka mora imati najmanje 12 znakova.")
    .max(128, "Lozinka može imati najviše 128 znakova."),
});
export type SignupInput = z.infer<typeof signupFormSchema>;

/** Uloga i dozvole koje administrator dodeljuje pri odobravanju zahteva. */
export const accessGrantSchema = inviteFormSchema.omit({ email: true, firstName: true, lastName: true });

export const passwordSchema = z
  .string()
  .min(12, "Lozinka mora imati najmanje 12 znakova.")
  .max(128, "Lozinka može imati najviše 128 znakova.");
