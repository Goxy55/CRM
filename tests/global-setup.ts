import "./env";
import { closePool, pool } from "../src/server/db";
import { migrate } from "../scripts/migrate";

/** Svako pokretanje testova kreće od prazne šeme i primenjuje sve migracije. */
export default async function setup() {
  await pool().query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(() => undefined);
  await closePool();
}
