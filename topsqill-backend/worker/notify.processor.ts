import { Job } from "bullmq";
import type { Pool } from "pg";
import type Redis from "ioredis";
import nodemailer from "nodemailer";
import { env } from "../src/common/env";
import { renderAlertEmail, alertPath } from "../src/notifications/alert-email";

/**
 * Delivers an alert outside the app. Today that is email; push to the mobile
 * app slots in here once it registers push tokens.
 *
 * An email is skipped when the alert was already read (the member saw it in
 * the app during the delay), when the address is not verified, or when the
 * member was emailed about the same thing recently, so nobody is flooded.
 */
const THROTTLE_SECONDS: Record<string, number> = { message: 30 * 60, connection: 10 * 60, lead: 60, job: 10 * 60, match: 6 * 3600, comment: 30 * 60, post: 6 * 3600, system: 60 };

const transport = env.SMTP_HOST && env.EMAIL_FROM
  ? nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export async function deliverNotification(job: Job<{ notificationId: string }>, pool: Pool, redis: Redis) {
  const { rows } = await pool.query(
    `select n.id, n.kind, n.title, n.body, n.target_type, n.target_id, n.read_at, n.user_id,
            u.name, u.email, u.email_verified, u.status
       from notifications n join users u on u.id = n.user_id where n.id = $1`, [job.data.notificationId]);
  const n = rows[0];
  if (!n) return { skipped: "gone" };
  if (n.read_at) return { skipped: "already read" };
  if (n.status !== "active" || !n.email || !n.email_verified) return { skipped: "no verified email" };

  // Messages and listing decisions are throttled per chat / per listing, so each listing's decision is emailed.
  const key = `mail:${n.user_id}:${n.kind}:${n.kind === "message" || n.kind === "listing" || n.kind === "campaign" ? n.target_id : ""}`;
  const fresh = await redis.set(key, "1", "EX", THROTTLE_SECONDS[n.kind] ?? 600, "NX");
  if (!fresh) return { skipped: "throttled" };

  const mail = renderAlertEmail({ kind: n.kind, title: n.title, body: n.body, name: n.name, url: `${env.WEB_URL.replace(/\/$/, "")}${alertPath(n.target_type, n.target_id)}` });
  if (!transport) {
    console.log(JSON.stringify({ severity: "INFO", message: "alert email (SMTP not configured)", to: n.email, subject: mail.subject }));
    return { skipped: "no smtp" };
  }
  await transport.sendMail({ from: env.EMAIL_FROM, to: n.email, subject: mail.subject, text: mail.text, html: mail.html });
  return { sent: true };
}
