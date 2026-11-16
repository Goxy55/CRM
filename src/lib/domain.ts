/** Šifarnici ugrađeni u model (vrednosti u bazi). Nazivi za prikaz su u src/i18n. */
export const CLIENT_TYPES = ["person", "farm", "entrepreneur", "company"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_STATUSES = ["potential", "contacted", "negotiation", "active", "inactive", "archived"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const COLLABORATION_STATUSES = [
  "planned",
  "negotiation",
  "contracted",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type CollaborationStatus = (typeof COLLABORATION_STATUSES)[number];

/** Saradnje koje se računaju kao aktivne (KPI „Aktivne saradnje“). */
export const ACTIVE_COLLABORATION_STATUSES: CollaborationStatus[] = ["contracted", "in_progress"];

export const CURRENCIES = ["RSD", "EUR", "USD", "CHF"] as const;

export const hasPersonName = (type: ClientType) => type !== "company";
export const hasBusiness = (type: ClientType) => type === "entrepreneur" || type === "company";

/** JMBG: 13 cifara i kontrolna cifra po modulu 11. */
export function isValidJmbg(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const d = [...value].map(Number);
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += (7 - i) * (d[i] + d[i + 6]);
  let control = 11 - (sum % 11);
  if (control > 9) control = 0;
  return control === d[12];
}
