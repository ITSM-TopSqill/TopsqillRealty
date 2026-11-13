import { Job } from "bullmq";
import type { Pool } from "pg";
import type Redis from "ioredis";
import nodemailer from "nodemailer";
import { env } from "../src/common/env";
import { renderAlertEmail, alertPath } from "../src/notifications/alert-email";
import { wantsAlert, unsubscribeSig } from "../src/notifications/alert-prefs";
import { sendPush } from "./push";

/**
 * Delivers an alert outside the app: a push to the member's phones straight
 * away ("push" jobs) and, after a short wait, an email ("deliver" jobs).
 *
 * Nothing goes out for a kind of alert the member switched off in Settings.
 * An email is also skipped when the alert was already read (the member saw it
 * in the app during the delay), when the address is not verified, or when the
 * member was emailed about the same thing recently, so nobody is flooded.
 */
const THROTTLE_SECONDS: Record<string, number> = { message: 30 * 60, connection: 10 * 60, lead: 60, job: 10 * 60, match: 6 * 3600, comment: 30 * 60, post: 6 * 3600, system: 60 };
/** Pushes are throttled far less: a phone buzz per chat every 30 seconds at most. */
const PUSH_THROTTLE_SECONDS: Record<string, number> = { message: 30, post: 3600, match: 600, comment: 120 };

const transport = env.SMTP_HOST && env.EMAIL_FROM
  ? nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

const web = () => env.WEB_URL.replace(/\/$/, "");

async function load(pool: Pool, id: string) {
  const { rows } = await pool.query(
    `select n.id, n.kind, n.title, n.body, n.target_type, n.target_id, n.read_at, n.user_id,
            u.name, u.email, u.email_verified, u.status, u.alert_prefs
       from notifications n join users u on u.id = n.user_id where n.id = $1`, [id]);
  return rows[0];
}

export async function deliverNotification(job: Job<{ notificationId: string }>, pool: Pool, redis: Redis) {
  if (job.name === "push") return pushNotification(job, pool, redis);
  const n = await load(pool, job.data.notificationId);
  if (!n) return { skipped: "gone" };
  if (n.read_at) return { skipped: "already read" };
  if (n.status !== "active" || !n.email || !n.email_verified) return { skipped: "no verified email" };
  if (!wantsAlert(n.alert_prefs, "email", n.kind)) return { skipped: "turned off" };

  // Messages and listing decisions are throttled per chat / per listing, so each listing's decision is emailed.
  const key = `mail:${n.user_id}:${n.kind}:${n.kind === "message" || n.kind === "listing" || n.kind === "campaign" ? n.target_id : ""}`;
  const fresh = await redis.set(key, "1", "EX", THROTTLE_SECONDS[n.kind] ?? 600, "NX");
  if (!fresh) return { skipped: "throttled" };

  const unsubKind = n.kind === "system" ? null : n.kind;
  const unsubscribeUrl = unsubKind ? `${web()}/unsubscribe?u=${n.user_id}&k=${unsubKind}&t=${unsubscribeSig(env.JWT_SECRET, n.user_id, unsubKind)}` : undefined;
  const mail = renderAlertEmail({ kind: n.kind, title: n.title, body: n.body, name: n.name, url: `${web()}${alertPath(n.target_type, n.target_id)}`, unsubscribeUrl, settingsUrl: `${web()}/settings/alerts` });
  if (!transport) {
    console.log(JSON.stringify({ severity: "INFO", message: "alert email (SMTP not configured)", to: n.email, subject: mail.subject }));
    return { skipped: "no smtp" };
  }
  // Mail apps show their own "Unsubscribe" button from these headers; one click turns this kind of email off.
  const api = (env.API_PUBLIC_URL ?? "").replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (unsubKind && api) {
    headers["List-Unsubscribe"] = `<${api}/v1/alerts/unsubscribe/one-click?u=${n.user_id}&k=${unsubKind}&t=${unsubscribeSig(env.JWT_SECRET, n.user_id, unsubKind)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  await transport.sendMail({ from: env.EMAIL_FROM, to: n.email, subject: mail.subject, text: mail.text, html: mail.html, headers });
  return { sent: true };
}

async function pushNotification(job: Job<{ notificationId: string }>, pool: Pool, redis: Redis) {
  const n = await load(pool, job.data.notificationId);
  if (!n) return { skipped: "gone" };
  if (n.read_at) return { skipped: "already read" };
  if (n.status !== "active") return { skipped: "inactive" };
  if (!wantsAlert(n.alert_prefs, "push", n.kind)) return { skipped: "turned off" };
  const { rows } = await pool.query(`select token from push_tokens where user_id = $1 and platform in ('android','ios') limit 20`, [n.user_id]);
  if (!rows.length) return { skipped: "no devices" };

  const wait = PUSH_THROTTLE_SECONDS[n.kind];
  const throttleKey = `push:${n.user_id}:${n.kind}:${n.target_id ?? ""}`;
  if (wait) {
    const fresh = await redis.set(throttleKey, "1", "EX", wait, "NX");
    if (!fresh) return { skipped: "throttled" };
  }
  const path = alertPath(n.target_type, n.target_id);
  // A failed send is retried by the queue, so it must not count against the throttle.
  const res = await sendPush(rows.map((r) => r.token as string), {
    title: n.title, body: n.body, url: `${web()}${path}`,
    data: { path, kind: n.kind, notificationId: n.id, targetType: n.target_type ?? "", targetId: n.target_id ?? "" },
  }).catch(async (e) => { if (wait) await redis.del(throttleKey).catch(() => 0); throw e; });
  if (res.dead.length) await pool.query(`delete from push_tokens where token = any($1)`, [res.dead]);
  return res;
}
