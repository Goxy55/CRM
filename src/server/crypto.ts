import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
export { isValidJmbg } from "@/lib/domain";
import { env } from "./env";


/** AES-256-GCM; zapis: verzija.iv.oznaka.šifrat (base64url). */
export function encryptJmbg(jmbg: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", env().jmbgEncryptionKey, iv);
  const data = Buffer.concat([cipher.update(jmbg, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptJmbg(stored: string): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Nepoznat format šifrovanog podatka.");
  const decipher = createDecipheriv("aes-256-gcm", env().jmbgEncryptionKey, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Otisak za tačno poklapanje (duplikati, pretraga). HMAC sa zasebnim ključem,
 * vezan za organizaciju: isti JMBG u dve organizacije daje različite otiske.
 */
export function jmbgHash(tenantId: string, jmbg: string): string {
  return createHmac("sha256", env().jmbgIndexKey).update(`${tenantId}:${jmbg}`).digest("hex");
}

export const randomToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
