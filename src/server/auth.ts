import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { pool, withContext } from "./db";
import { env } from "./env";
import { sendMail } from "./mail";

const LOCK_WINDOW_MINUTES = 15;
const LOCK_MAX_FAILURES = 8;
export const MIN_PASSWORD_LENGTH = 12;

function create() {
  const e = env();
  return betterAuth({
    database: pool(),
    baseURL: e.appUrl,
    secret: e.authSecret,
    trustedOrigins: [e.appUrl],
    emailAndPassword: {
      enabled: true,
      // Nalozi nastaju isključivo pozivnicom; otvorena registracija ne postoji.
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "CRM — promena lozinke",
          text: `Zatražena je promena lozinke za vaš nalog.\n\nLink važi jedan sat:\n${url}\n\nAko niste tražili promenu, zanemarite ovu poruku.`,
        });
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 12 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 120,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/request-password-reset": { window: 300, max: 5 },
        "/reset-password": { window: 300, max: 10 },
      },
    },
    advanced: { useSecureCookies: e.appUrl.startsWith("https://") },
    hooks: {
      // Zaključavanje po nalogu: ne zavisi od IP adrese, koju napadač može menjati.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = String(ctx.body?.email ?? "").trim().toLowerCase();
        if (!email) return;
        if (await isLockedOut(email))
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Previše neuspelih pokušaja. Pokušajte ponovo za 15 minuta.",
          });
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = String(ctx.body?.email ?? "").trim().toLowerCase();
        if (!email) return;
        await recordLoginAttempt(email, !!ctx.context.newSession);
      }),
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await withContext({ userId: session.userId }, (db) =>
              db.query("UPDATE profiles SET last_login_at = now() WHERE user_id = $1", [session.userId]),
            ).catch((e) => console.error("last_login_at:", e));
          },
        },
      },
    },
  });
}

/** Zaključavanje po nalogu: previše neuspelih pokušaja od poslednje uspešne prijave. */
export async function isLockedOut(email: string): Promise<boolean> {
  const r = await pool().query<{ failures: number }>(
    `SELECT count(*)::int AS failures FROM login_attempts
     WHERE email = $1 AND NOT succeeded AND created_at > now() - make_interval(mins => $2)
       AND created_at > coalesce((SELECT max(created_at) FROM login_attempts
                                  WHERE email = $1 AND succeeded), '-infinity')`,
    [email.toLowerCase(), LOCK_WINDOW_MINUTES],
  );
  return r.rows[0].failures >= LOCK_MAX_FAILURES;
}

export async function recordLoginAttempt(email: string, succeeded: boolean) {
  await pool().query("INSERT INTO login_attempts (email, succeeded) VALUES ($1, $2)", [email.toLowerCase(), succeeded]);
  await pool().query("DELETE FROM login_attempts WHERE created_at < now() - interval '30 days'");
}

/** Provera lozinke postojećeg naloga (bez otvaranja sesije). */
export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
  const r = await pool().query<{ password: string | null }>(
    `SELECT password FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`,
    [userId],
  );
  const hash = r.rows[0]?.password;
  if (!hash) return false;
  const ctx = await getAuth().$context;
  return ctx.password.verify({ hash, password });
}

type Auth = ReturnType<typeof create>;
const store = globalThis as { __crmAuth?: Auth };

export function getAuth(): Auth {
  return (store.__crmAuth ??= create());
}

/**
 * Kreira nalog sa lozinkom (prihvatanje pozivnice, CLI). Javni endpoint za
 * registraciju je isključen, pa se koristi interni sloj biblioteke.
 */
export async function createUserWithPassword(input: { email: string; name: string; password: string }) {
  const ctx = await getAuth().$context;
  const hash = await ctx.password.hash(input.password);
  const user = await ctx.internalAdapter.createUser(
    { email: input.email.toLowerCase(), name: input.name, emailVerified: true },
    { method: "email-password" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });
  return user.id as string;
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const r = await pool().query<{ id: string }>('SELECT id FROM "user" WHERE lower(email) = $1', [
    email.toLowerCase(),
  ]);
  return r.rows[0]?.id ?? null;
}
