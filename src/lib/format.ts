const TZ = "Europe/Belgrade";
const LOCALE = "sr-Latn-RS";

export const formatDate = (value: Date | string | null | undefined) =>
  !value
    ? "—"
    : typeof value === "string"
      ? value.split("-").reverse().join(".") + "."
      : value.toLocaleDateString(LOCALE, { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

export const formatDateTime = (value: Date | null | undefined) =>
  !value
    ? "—"
    : value.toLocaleString(LOCALE, { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Iznos iz baze (tekst, numeric) bez prolaska kroz float. */
export const formatMoney = (value: string | null | undefined, currency: string) =>
  value == null
    ? "—"
    : `${new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value as unknown as number)} ${currency}`;

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
