import { sr } from "./sr";

/**
 * Tekstovi interfejsa. Za sada postoji samo srpski (latinica); novi jezik se
 * dodaje kao još jedan rečnik istog oblika i izborom ovde.
 */
export type Dictionary = typeof sr;
export const t: Dictionary = sr;
export const labels = sr.labels;
