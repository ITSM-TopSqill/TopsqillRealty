import Anthropic from "@anthropic-ai/sdk";
import type { Pool } from "pg";
import { env } from "../src/common/env";
import { newId } from "../src/common/ids";

/** The labels buyers see on photos. The AI must pick one of these. */
export const PHOTO_LABELS = [
  "Exterior", "Living room", "Bedroom", "Kitchen", "Bathroom", "Balcony", "Dining", "Study",
  "Lobby", "Swimming pool", "Gym", "Clubhouse", "Garden", "Kids’ play area", "Parking",
  "View", "Floor plan", "Site plan", "Construction", "Other",
] as const;

/** "IMG_2034.jpg", "WhatsApp Image 2026-…" and empty labels get replaced; a label someone typed is kept. */
export function needsLabel(label: string | null | undefined) {
  if (!label) return true;
  return /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i.test(label) || /^(img|dsc|pxl|photo|image|whatsapp|screenshot)[\s_-]/i.test(label);
}

let client: Anthropic | null = null;

/**
 * Tags a property photo (Kitchen, Bedroom, Exterior…) so galleries can show
 * what each photo is. Runs after the photo is resized, on the small "card" copy.
 * Never fails the upload: without an AI key, or on any error, the photo keeps
 * its current label.
 */
export async function tagPhoto(pool: Pool, mediaId: string, ownerId: string | null, jpeg: Buffer, currentLabel: string | null) {
  if (!env.ANTHROPIC_API_KEY || !needsLabel(currentLabel)) return null;
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  const started = Date.now();
  try {
    const fallback = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"].includes(env.CLAUDE_MODEL);
    const res = await client.beta.messages.create({
      model: env.CLAUDE_MODEL,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
          { type: "text", text: `This photo is from an Indian property listing. Which one of these best describes it?\n${PHOTO_LABELS.join(", ")}\n\nReply with the label only, exactly as written.` },
        ],
      }],
    }, { timeout: 30_000 });
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim().replace(/[."]/g, "");
    const label = PHOTO_LABELS.find((l) => l.toLowerCase() === text.toLowerCase())
      ?? PHOTO_LABELS.find((l) => text.toLowerCase().includes(l.toLowerCase()));
    await record(pool, ownerId, res.usage, Date.now() - started, res.stop_reason !== "refusal");
    if (!label || label === "Other") return null;
    await pool.query("update media set label=$2 where id=$1", [mediaId, label]);
    return label;
  } catch (e) {
    await record(pool, ownerId, null, Date.now() - started, false);
    console.warn(`photo tag skipped for ${mediaId}: ${(e as Error).message.slice(0, 160)}`);
    return null;
  }
}

async function record(pool: Pool, userId: string | null, usage: { input_tokens?: number | null; output_tokens?: number | null } | null, ms: number, ok: boolean) {
  await pool.query(
    "insert into ai_usage (id, user_id, feature, model, input_tokens, output_tokens, ms, ok) values ($1,$2,'photo.tag',$3,$4,$5,$6,$7)",
    [newId(), userId, env.CLAUDE_MODEL, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0, ms, ok],
  ).catch(() => {});
}
