import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { env } from "./env";

export const mailConfigured = () => !!env().smtpUrl && !!env().mailFrom;

/**
 * Slanje poruke. Bez SMTP-a u razvoju poruka se upisuje u .data/mail (da se
 * tok može probati); u produkciji je to greška konfiguracije.
 */
export async function sendMail(message: { to: string; subject: string; text: string }) {
  const e = env();
  if (e.smtpUrl && e.mailFrom) {
    const { default: nodemailer } = await import("nodemailer");
    await nodemailer.createTransport(e.smtpUrl).sendMail({ from: e.mailFrom, ...message });
    return;
  }
  if (e.production) throw new Error("SMTP nije podešen (SMTP_URL, MAIL_FROM).");
  const dir = process.env.MAIL_DIR || ".data/mail";
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(`${dir}/${Date.now()}-${randomUUID()}.json`, JSON.stringify(message, null, 2), { mode: 0o600 });
}
