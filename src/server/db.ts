import { Pool, types, type PoolClient } from "pg";

// DATE ostaje tekst "YYYY-MM-DD"; pretvaranje u Date bi pomeralo dan po vremenskoj zoni.
types.setTypeParser(1082, (v) => v);

const store = globalThis as { __crmPool?: Pool; __crmRlsCheck?: Promise<void> };

export function pool(): Pool {
  if (!store.__crmPool) {
    // Samo podešavanja baze: migracije i skripte ne zahtevaju ostatak konfiguracije
    // (adresu aplikacije, tajne), koji pri objavi ne mora još biti dostupan.
    const { DATABASE_URL, DATABASE_SSL } = process.env;
    if (!DATABASE_URL) throw new Error("DATABASE_URL nije podešen.");
    store.__crmPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 60000,
    });
    store.__crmPool.on("error", (e) => console.error("PostgreSQL pool:", e.message));
  }
  return store.__crmPool;
}

export async function closePool() {
  await store.__crmPool?.end();
  store.__crmPool = undefined;
  store.__crmRlsCheck = undefined;
}

/**
 * Izolacija organizacija počiva na RLS-u, a superuser i BYPASSRLS nalozi ga
 * zaobilaze. Sa takvim nalogom aplikacija odbija rad.
 */
function assertRlsEnforced(): Promise<void> {
  store.__crmRlsCheck ??= pool()
    .query("SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user")
    .then((r) => {
      if (r.rows[0]?.bypass)
        throw new Error(
          "Nalog baze zaobilazi Row Level Security (superuser ili BYPASSRLS). Koristite običan nalog; vidi DEPLOYMENT.md.",
        );
    });
  return store.__crmRlsCheck;
}

export type Db = Pick<PoolClient, "query">;

export type DbContext = {
  tenantId?: string | null;
  userId?: string | null;
  platform?: boolean;
  inviteHash?: string | null;
  signupToken?: string | null;
};

/**
 * Jedina dozvoljena putanja do poslovnih tabela: transakcija sa postavljenim
 * kontekstom koji RLS pravila čitaju. Kontekst važi samo unutar transakcije.
 */
export async function withContext<T>(context: DbContext, fn: (db: Db) => Promise<T>): Promise<T> {
  await assertRlsEnforced();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await setContext(client, context);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function setContext(db: Db, context: DbContext) {
  await db.query(
    `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true),
            set_config('app.platform', $3, true), set_config('app.invite_hash', $4, true),
            set_config('app.signup_token', $5, true)`,
    [
      context.tenantId ?? "",
      context.userId ?? "",
      context.platform ? "on" : "",
      context.inviteHash ?? "",
      context.signupToken ?? "",
    ],
  );
}

/** Deo transakcije koji sme da ne uspe bez poništavanja ostatka (npr. red uvoza). */
export async function savepoint<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query("SAVEPOINT sp");
  try {
    const result = await fn();
    await db.query("RELEASE SAVEPOINT sp");
    return result;
  } catch (e) {
    await db.query("ROLLBACK TO SAVEPOINT sp");
    throw e;
  }
}
