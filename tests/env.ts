import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Okruženje testova: zasebna baza, sintetički ključevi, pošta u privremeni direktorijum. */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://crm:crm-local-dev@127.0.0.1:5544/crm_test";
process.env.APP_URL = "http://localhost:3999";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-test";
process.env.JMBG_ENCRYPTION_KEY = "11".repeat(32);
process.env.JMBG_INDEX_KEY = "22".repeat(32);
process.env.MAIL_DIR ||= mkdtempSync(path.join(tmpdir(), "crm-mail-"));
delete process.env.SMTP_URL;
