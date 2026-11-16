import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Konfiguracija iz okruženja. Čita se pri prvoj upotrebi (ne pri učitavanju
 * modula), da `next build` ne zahteva produkcione tajne.
 */
export type Env = {
  production: boolean;
  databaseUrl: string;
  databaseSsl: boolean;
  appUrl: string;
  authSecret: string;
  jmbgEncryptionKey: Buffer;
  jmbgIndexKey: Buffer;
  smtpUrl?: string;
  mailFrom?: string;
};

let cached: Env | undefined;

function devSecrets(): Record<string, string> {
  const file = ".data/dev-secrets.json";
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const secrets = {
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    JMBG_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    JMBG_INDEX_KEY: randomBytes(32).toString("hex"),
  };
  mkdirSync(".data", { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

/**
 * Ključ od 32 bajta. Prihvata 64 heksadecimalna znaka (openssl rand -hex 32)
 * ili bilo koju nasumičnu vrednost od najmanje 32 znaka, kakvu generišu
 * hosting platforme; iz nje se ključ izvodi heširanjem (SHA-256).
 */
function key(name: string, value: string | undefined): Buffer {
  if (value && /^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  if (value && value.length >= 32) return createHash("sha256").update(`${name}:${value}`).digest();
  throw new Error(`${name} mora imati najmanje 32 nasumična znaka (npr. openssl rand -hex 32).`);
}

export function env(): Env {
  if (cached) return cached;
  const e = process.env;
  const production = e.NODE_ENV === "production";
  if (!e.DATABASE_URL) throw new Error("DATABASE_URL nije podešen.");
  // Render sam postavlja RENDER_EXTERNAL_URL; koristi se kada APP_URL nije zadat.
  const appUrl = e.APP_URL || e.RENDER_EXTERNAL_URL || (production ? "" : "http://localhost:3000");
  if (!appUrl) throw new Error("APP_URL je obavezan u produkciji.");
  const url = new URL(appUrl);
  if (url.origin !== appUrl)
    throw new Error("APP_URL mora biti puna adresa bez putanje i završne kose crte.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (production && url.protocol !== "https:" && !local)
    throw new Error("Javno produkciono okruženje zahteva HTTPS APP_URL.");
  // U razvoju se nedostajuće tajne generišu lokalno, van repozitorijuma.
  const fallback =
    !production && !(e.BETTER_AUTH_SECRET && e.JMBG_ENCRYPTION_KEY && e.JMBG_INDEX_KEY)
      ? devSecrets()
      : {};
  const authSecret = e.BETTER_AUTH_SECRET || fallback.BETTER_AUTH_SECRET || "";
  if (authSecret.length < 32)
    throw new Error("BETTER_AUTH_SECRET mora imati najmanje 32 nasumična znaka.");
  cached = {
    production,
    databaseUrl: e.DATABASE_URL,
    databaseSsl: e.DATABASE_SSL === "true",
    appUrl,
    authSecret,
    jmbgEncryptionKey: key("JMBG_ENCRYPTION_KEY", e.JMBG_ENCRYPTION_KEY || fallback.JMBG_ENCRYPTION_KEY),
    jmbgIndexKey: key("JMBG_INDEX_KEY", e.JMBG_INDEX_KEY || fallback.JMBG_INDEX_KEY),
    smtpUrl: e.SMTP_URL || undefined,
    mailFrom: e.MAIL_FROM || undefined,
  };
  return cached;
}
