import Anthropic from "@anthropic-ai/sdk";
import type { Pool } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "../src/common/env";
import { newId } from "../src/common/ids";
import { scrubSources } from "../src/common/sources";
import { PHOTO_LABELS } from "./photo-tags";

const run = promisify(execFile);

export type VideoScenes = { branded?: boolean; items: { t: number; room: string; caption: string; line: string }[] };

/** Evenly spaced moments to look at: about one every 6 seconds, 4 to 12 in all, skipping the very start and end. */
export function frameTimes(durationS: number): number[] {
  if (!(durationS > 0)) return [0];
  const n = Math.max(4, Math.min(12, Math.round(durationS / 6)));
  const step = durationS / n;
  return Array.from({ length: n }, (_, i) => Math.round((step * i + step * 0.4) * 10) / 10);
}

/** Turns the model's reply into scenes, keeping only sane values and never another site's name. */
export function parseScenes(text: string, times: number[]): VideoScenes | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: { branded?: unknown; scenes?: unknown };
  try { j = JSON.parse(m[0]); } catch { return null; }
  const list = Array.isArray(j.scenes) ? j.scenes : [];
  const items = list.slice(0, times.length).map((s: Record<string, unknown>, i: number) => {
    const room = PHOTO_LABELS.find((l) => l.toLowerCase() === String(s?.room ?? "").toLowerCase()) ?? "Other";
    return {
      t: times[i] ?? 0, room,
      caption: scrubSources(String(s?.caption ?? "")).slice(0, 40),
      line: scrubSources(String(s?.line ?? "")).slice(0, 180),
    };
  }).filter((s) => s.caption || s.line);
  return items.length ? { branded: j.branded === true, items } : null;
}

let client: Anthropic | null = null;

/**
 * "Watches" an uploaded walkthrough video: takes evenly spaced frames with
 * ffmpeg and asks the AI, for each, which room it is, a short on-screen
 * caption ("Subtle wall texture", "Modular kitchen") and a narration line.
 * The guided video plays the owner's own clip with these. It also notes a
 * video that shows another site's logo, so the guided video leaves it out.
 * Never fails the upload: without AI, ffmpeg or on any error, nothing changes.
 */
export async function analyseVideo(pool: Pool, mediaId: string, ownerId: string | null, file: Buffer) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const dir = await mkdtemp(join(tmpdir(), "scenes-"));
  const started = Date.now();
  try {
    const src = join(dir, "in");
    await writeFile(src, file);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], { timeout: 30_000 });
    const duration = Number(stdout.trim()) || 0;
    const times = frameTimes(duration);
    const frames: Buffer[] = [];
    for (const [i, t] of times.entries()) {
      const out = join(dir, `f${i}.jpg`);
      await run("ffmpeg", ["-y", "-ss", String(t), "-i", src, "-frames:v", "1", "-vf", "scale='min(768,iw)':-2", "-q:v", "5", out], { timeout: 30_000 });
      frames.push(await readFile(out));
    }
    if (duration) await pool.query("update media set duration_ms=$2 where id=$1", [mediaId, Math.round(duration * 1000)]);

    client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
    const fallback = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"].includes(env.CLAUDE_MODEL);
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    frames.forEach((f, i) => {
      content.push({ type: "text", text: `Frame ${i + 1} at ${times[i]}s:` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.toString("base64") } });
    });
    content.push({ type: "text", text: `These frames are from a walkthrough video of an Indian property, uploaded by its owner for their listing. For each frame, in order:
- "room": one of ${PHOTO_LABELS.join(", ")}
- "caption": 2 to 4 words for an on-screen title about something clearly visible (for example "Subtle wall texture", "Modular kitchen", "Wooden ceiling trim", "Sunlit balcony")
- "line": one warm narration sentence, at most 18 words, about only what is visible. Never guess sizes, brands or prices.
Never mention any website, app, channel or company. Also say whether any frame shows another website's or company's logo, watermark or channel name ("branded").

Reply with JSON only: {"branded": false, "scenes": [{"room": "...", "caption": "...", "line": "..."}]}` });
    const res = await client.beta.messages.create({
      model: env.CLAUDE_MODEL,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content }],
    }, { timeout: 90_000 });
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
    const scenes = parseScenes(text, times);
    await record(pool, ownerId, res.usage, Date.now() - started, !!scenes);
    if (!scenes) return null;
    await pool.query("update media set scenes=$2 where id=$1", [mediaId, JSON.stringify(scenes)]);
    return scenes;
  } catch (e) {
    await record(pool, ownerId, null, Date.now() - started, false);
    console.warn(`video scenes skipped for ${mediaId}: ${(e as Error).message.slice(0, 160)}`);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function record(pool: Pool, userId: string | null, usage: { input_tokens?: number | null; output_tokens?: number | null } | null, ms: number, ok: boolean) {
  await pool.query(
    "insert into ai_usage (id, user_id, feature, model, input_tokens, output_tokens, ms, ok) values ($1,$2,'video.scenes',$3,$4,$5,$6,$7)",
    [newId(), userId, env.CLAUDE_MODEL, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0, ms, ok],
  ).catch(() => {});
}
