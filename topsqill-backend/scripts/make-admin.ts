/**
 * Gives a member admin access (or takes it away), by email.
 *
 *   node dist/scripts/make-admin.js contact@topsqill.com          # make admin
 *   node dist/scripts/make-admin.js contact@topsqill.com --remove # remove admin
 *
 * On Google Cloud it runs through the migrate job, which can reach the
 * private database (see the README or the deploy notes). The member must have
 * signed up with that email first. Admin rights are part of the sign-in
 * token, so they apply after the member signs out and back in.
 */
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { env } from "../src/common/env";
import { poolConfig } from "../src/db/pool-config";

async function main() {
  const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const remove = process.argv.includes("--remove") || process.env.ADMIN_REMOVE === "true";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Give the member's email: make-admin.js you@example.com");

  const pool = new Pool(poolConfig(env.DATABASE_URL));
  try {
    const { rows } = await pool.query(
      "update users set is_admin = $2, updated_at = now() where lower(email) = $1 returning id, name, status, email_verified",
      [email, !remove]);
    if (!rows.length) throw new Error(`No member has the email ${email}. Sign up on the website with it first, then run this again.`);
    for (const u of rows) {
      await pool.query(
        "insert into audit_log (id, actor_id, action, target_type, target_id, meta) values ($1, null, $2, 'user', $3, $4)",
        [randomUUID(), remove ? "admin.revoke" : "admin.grant", u.id, JSON.stringify({ email, via: "make-admin script" })],
      ).catch(() => { /* the audit entry is a nice-to-have */ });
      console.log(`${remove ? "Removed admin from" : "Made admin:"} ${u.name} <${email}> (${u.id})${u.status !== "active" ? ` — note: account status is ${u.status}` : ""}`);
    }
    console.log("Sign out and back in on the website for this to take effect.");
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
