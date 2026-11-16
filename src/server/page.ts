import { notFound, redirect } from "next/navigation";
import { AppError } from "./errors";

/**
 * Za stranice: nepostojeći ili tuđi zapis postaje 404, a nedostatak dozvole
 * vodi na početnu. Ostale greške idu na stranicu greške.
 */
export async function load<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    if (e instanceof AppError && e.code === "FORBIDDEN") redirect("/?zabranjeno=1");
    throw e;
  }
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
