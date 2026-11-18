import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Queue } from "bullmq";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../src/common/env";
import { aiAllowed, cleanAiSettings } from "../src/ai/ai-settings";

/** An open lead with no activity for this long gets a reminder. */
const STALE_DAYS = Number(process.env.FOLLOWUP_STALE_DAYS ?? 2);
/** Never reminded more than once this often for the same silence. */
const RENUDGE_DAYS = 7;

let client: Anthropic | null = null;

type StaleLeadRow = {
  id: string; owner_id: string; assignee_id: string | null; name: string; phone: string | null;
  stage: string; budget_max: number | null; locality: string | null;
  listing_title: string | null; sender_name: string | null; sender_agency: string | null;
};

/**
 * Every hour: finds open leads (not booked or lost) gone quiet for
 * FOLLOWUP_STALE_DAYS, drafts a short WhatsApp nudge with AI, and notifies
 * the lead's owner (or assignee). The draft is only ever a suggestion -
 * nothing is sent automatically; the member reviews and taps send.
 */
export async function remindStaleLeads(pool: Pool, notifyQueue?: Queue) {
  const { rows } = await pool.query<StaleLeadRow>(
    `select l.id, l.owner_id, l.assignee_id, l.name, l.phone, l.stage, l.budget_max, l.locality,
            lst.title as listing_title, u.name as sender_name, u.agency as sender_agency
       from leads l
       left join listings lst on lst.id = l.listing_id
       left join users u on u.id = coalesce(l.assignee_id, l.owner_id)
      where l.stage not in ('booked','lost')
        and l.last_activity_at < now() - ($1 || ' days')::interval
        and (l.followup_reminded_at is null
             or l.followup_reminded_at < l.last_activity_at
             or l.followup_reminded_at < now() - ($2 || ' days')::interval)
      order by l.last_activity_at asc
      limit 50`,
    [STALE_DAYS, RENUDGE_DAYS],
  );

  let reminded = 0;
  for (const r of rows) {
    try {
      const draft = await draftFollowUp(pool, r);
      await pool.query(
        `update leads set followup_draft = $2, followup_draft_channel = 'whatsapp', followup_reminded_at = now() where id = $1`,
        [r.id, draft],
      );
      const notifId = randomUUID();
      await pool.query(
        `insert into notifications (id, user_id, kind, title, body, target_type, target_id) values ($1,$2,'lead',$3,$4,'lead',$5)`,
        [notifId, r.assignee_id ?? r.owner_id, `Follow up with ${r.name}`,
          `No activity for ${STALE_DAYS}+ days. A WhatsApp message is drafted and ready to send.`, r.id],
      );
      await notifyQueue?.add("push", { notificationId: notifId }, { jobId: `push-${notifId}` }).catch(() => {});
      await notifyQueue?.add("deliver", { notificationId: notifId }, { jobId: `notif-${notifId}` }).catch(() => {});
      reminded++;
    } catch (e) {
      console.error(JSON.stringify({ severity: "ERROR", message: "stale lead reminder failed", leadId: r.id, error: (e as Error).message }));
    }
  }
  return { reminded };
}

/** Same prompt and shape as the member's own "write a follow-up" button, run here without the API's DI container. */
async function draftFollowUp(pool: Pool, r: StaleLeadRow): Promise<string> {
  const first = (r.name || "there").split(" ")[0];
  const fallback = `Hi ${first}! 👋 Just checking in about ${r.listing_title ?? "the property"} — still interested? Happy to arrange a site visit whenever suits you. – ${r.sender_name ?? "Your Topsqill.ai advisor"}`;
  if (!env.ANTHROPIC_API_KEY) return fallback;

  const settingsRow = await pool.query("select value from app_settings where key = 'ai'").catch(() => ({ rows: [] as { value: unknown }[] }));
  const settings = cleanAiSettings(settingsRow.rows[0]?.value);
  if (!aiAllowed(settings, "write.followup")) return fallback;

  const model = settings.model ?? env.CLAUDE_MODEL;
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  const started = Date.now();
  try {
    const fallbackRouting = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"].includes(model);
    const res = await client.beta.messages.create({
      model,
      ...(fallbackRouting ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{
        role: "user",
        content: `Write a short WhatsApp message (max 60 words, 1 emoji) re-engaging a property lead who has gone quiet for a few days.
Return ONLY JSON {"text": the message}. Warm, not pushy, with one clear next step (a call or a site visit).
Lead: ${JSON.stringify({ name: r.name, listingTitle: r.listing_title, budgetMax: r.budget_max, locality: r.locality, stage: r.stage })}. Sender: ${JSON.stringify({ name: r.sender_name, agency: r.sender_agency })}`,
      }],
    }, { timeout: 30_000 });
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
    await record(pool, r.owner_id, res.usage, Date.now() - started, res.stop_reason !== "refusal");
    const cleaned = text.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
    const parsed = JSON.parse(start >= 0 ? cleaned.slice(start, end + 1) : cleaned) as { text?: string };
    return (parsed.text && String(parsed.text).trim()) || fallback;
  } catch (e) {
    await record(pool, r.owner_id, null, Date.now() - started, false);
    console.warn(`stale-lead draft skipped for ${r.id}: ${(e as Error).message.slice(0, 160)}`);
    return fallback;
  }
}

async function record(pool: Pool, userId: string, usage: { input_tokens?: number | null; output_tokens?: number | null } | null, ms: number, ok: boolean) {
  await pool.query(
    "insert into ai_usage (id, user_id, feature, model, input_tokens, output_tokens, ms, ok) values ($1,$2,'write.followup',$3,$4,$5,$6,$7)",
    [randomUUID(), userId, env.CLAUDE_MODEL, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0, ms, ok],
  ).catch(() => {});
}
