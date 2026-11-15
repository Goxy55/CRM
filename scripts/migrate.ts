import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { pool, closePool } from "../src/server/db";

/** Primena SQL migracija po imenu; svaka u svojoj transakciji, tačno jednom. */
export async function migrate(log: (line: string) => void = console.log) {
  const client = await pool().connect();
  try {
    // Dve instance pri istoj objavi: jedna migrira, druga čeka.
    await client.query("SELECT pg_advisory_lock(8140001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const dir = new URL("../migrations/", import.meta.url);
    const names = (await readdir(dir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    for (const name of names) {
      const done = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
      if (done.rows.length) continue;
      const sql = await readFile(new URL(name, dir), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
        log(`Primenjena migracija ${name}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(8140001)").catch(() => undefined);
    client.release();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  migrate()
    .then(() => console.log("Baza je ažurna."))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(closePool);
}
