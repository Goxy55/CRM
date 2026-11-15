import "dotenv/config";
import { createUserWithPassword, findUserIdByEmail, MIN_PASSWORD_LENGTH } from "../src/server/auth";
import { closePool, withContext } from "../src/server/db";

/**
 * Prvi administrator platforme (kontrolisan postupak, van aplikacije).
 * Lozinka se zadaje kroz okruženje, nikada kao argument komande:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_FIRST_NAME=... ADMIN_LAST_NAME=... npm run platform-admin
 * Za postojeći nalog lozinka se ne menja i ADMIN_PASSWORD nije potreban.
 */
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const firstName = process.env.ADMIN_FIRST_NAME?.trim() || "Administrator";
  const lastName = process.env.ADMIN_LAST_NAME?.trim() || "platforme";
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Postavite ADMIN_EMAIL.");
  let userId = await findUserIdByEmail(email);
  if (!userId) {
    if (!password || password.length < MIN_PASSWORD_LENGTH)
      throw new Error(`Postavite ADMIN_PASSWORD (najmanje ${MIN_PASSWORD_LENGTH} znakova).`);
    userId = await createUserWithPassword({ email, name: `${firstName} ${lastName}`, password });
  }
  await withContext({ userId, platform: true }, async (db) => {
    await db.query(
      "INSERT INTO profiles (user_id, first_name, last_name, email) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING",
      [userId, firstName, lastName, email],
    );
    await db.query("INSERT INTO platform_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    await db.query(
      "INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, summary) VALUES (NULL, $1, 'platform.admin_granted', 'user', $1, 'Dodeljena uloga administratora platforme (CLI)')",
      [userId],
    );
  });
  console.log(`Administrator platforme: ${email}`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closePool);
