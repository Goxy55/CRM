export type ErrorCode = "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "UNAUTHENTICATED";

/** Greška čija je poruka namenjena korisniku. Sve ostalo je interna greška. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (message = "Nemate dozvolu za ovu radnju.") =>
  new AppError("FORBIDDEN", message);
export const notFound = (message = "Traženi zapis ne postoji.") =>
  new AppError("NOT_FOUND", message);
export const invalid = (message: string, details?: unknown) =>
  new AppError("VALIDATION", message, details);
export const conflict = (message: string, details?: unknown) =>
  new AppError("CONFLICT", message, details);

/** Kod PostgreSQL greške, ako postoji (npr. 23505 za jedinstvenost). */
export const pgCode = (e: unknown): string | undefined =>
  typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : undefined;
