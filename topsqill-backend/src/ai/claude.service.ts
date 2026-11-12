import { Injectable, Inject, Logger, HttpException, HttpStatus } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import Redis from "ioredis";
import { createHash } from "node:crypto";
import { DB, type Database } from "../db/db.module";
import { REDIS } from "../redis/redis.module";
import { aiUsage, appSettings } from "../db/schema";
import { eq } from "drizzle-orm";
import { aiAllowed, cleanAiSettings, DEFAULT_AI_SETTINGS, type AiSettings } from "./ai-settings";
import { newId } from "../common/ids";
import { env } from "../common/env";

type Effort = "low" | "medium" | "high";

type AskOptions = {
  userId?: string;
  feature: string;
  maxTokens?: number;
  system?: string;
  images?: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }[];
  cacheSeconds?: number;
  timeoutMs?: number;
  /** How hard the model thinks. Short writing jobs and labels use "low". */
  effort?: Effort;
};

export type ChatOptions = AskOptions & {
  messages: Anthropic.Beta.BetaMessageParam[];
  tools?: Anthropic.Beta.BetaTool[];
};

const THINKING_ROOM: Record<Effort, number> = { low: 3000, medium: 6000, high: 12000 };

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 200);   // AI calls per member per day

/**
 * Models that accept server-side refusal fallbacks ("default" routing). When a
 * safety check declines a request on one of these, the API retries it on a
 * suitable model in the same call instead of returning nothing.
 */
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

/**
 * The only place that talks to Claude, through the official Anthropic SDK.
 *
 * The API key stays on the server, every call is rate limited per member,
 * identical prompts are cached, failures never crash a request, and usage is
 * recorded so cost can be tracked per feature.
 */
@Injectable()
export class ClaudeService {
  private readonly log = new Logger("claude");
  private client: Anthropic | null = null;

  constructor(@Inject(DB) private readonly db: Database, @Inject(REDIS) private readonly redis: Redis) {}

  get available() { return !!env.ANTHROPIC_API_KEY; }
  get model() { return this.settingsCache?.value.model ?? env.CLAUDE_MODEL; }

  private settingsCache: { value: AiSettings; at: number } | null = null;

  /** The admin's AI settings (Admin → AI), re-read at most every 30 seconds. */
  async settings(): Promise<AiSettings> {
    if (this.settingsCache && Date.now() - this.settingsCache.at < 30_000) return this.settingsCache.value;
    let value = DEFAULT_AI_SETTINGS;
    try {
      const [row] = await this.db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "ai")).limit(1);
      if (row) value = cleanAiSettings(row.value);
    } catch { /* table not there yet: defaults */ }
    this.settingsCache = { value, at: Date.now() };
    return value;
  }

  /** Forgets the cached settings (after an admin changes them). */
  resetSettings() { this.settingsCache = null; }

  /** Is AI on for this feature? (Configured, switched on, and not turned off for the feature.) */
  async enabledFor(feature: string) {
    return this.available && aiAllowed(await this.settings(), feature);
  }

  private sdk() {
    this.client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
    return this.client;
  }

  /** Asks for JSON and falls back to the supplied value if anything goes wrong. */
  async json<T>(prompt: string, fallback: () => T, opts: AskOptions): Promise<{ data: T; source: "claude" | "rules" }> {
    if (!(await this.enabledFor(opts.feature))) return { data: fallback(), source: "rules" };
    try {
      // Short structured writing jobs: low effort is fast and plenty.
      const text = await this.ask(prompt, { effort: "low", ...opts });
      const cleaned = text.replace(/```json|```/g, "").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      const parsed = JSON.parse(start >= 0 ? cleaned.slice(start, end + 1) : cleaned) as T;
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      return { data: parsed, source: "claude" };
    } catch (e) {
      if (e instanceof HttpException) throw e;            // the daily limit is shown to the member
      this.log.warn(`${opts.feature}: falling back to rules (${(e as Error).message})`);
      return { data: fallback(), source: "rules" };
    }
  }

  /** One question in, text out. */
  async ask(prompt: string, opts: AskOptions): Promise<string> {
    const key = `ai:${createHash("sha256").update(opts.feature + "|" + prompt + "|" + (opts.system ?? "")).digest("hex").slice(0, 32)}`;
    if (opts.cacheSeconds && !opts.images) {
      const hit = await this.redis.get(key).catch(() => null);
      if (hit) return hit;
    }
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const img of opts.images ?? []) {
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    }
    content.push({ type: "text", text: prompt });

    const res = await this.chat({ ...opts, messages: [{ role: "user", content }] });
    const text = textOf(res);
    if (opts.cacheSeconds && !opts.images && text) await this.redis.set(key, text, "EX", opts.cacheSeconds).catch(() => {});
    return text;
  }

  /**
   * One request to the Messages API, with tools if given. The caller runs the
   * tool loop (the assistant does), appending the full `content` it gets back.
   */
  async chat(opts: ChatOptions): Promise<Anthropic.Beta.BetaMessage> {
    if (!this.available) throw new Error("AI is not configured");
    if (!(await this.enabledFor(opts.feature))) throw new Error("AI is turned off for this feature");
    await this.checkQuota(opts.userId);

    const started = Date.now();
    const fallback = FALLBACK_MODELS.has(this.model);
    try {
      const res = await this.sdk().beta.messages.create({
        model: this.model,
        // `maxTokens` is the size of the answer; thinking counts towards the
        // limit too, so room is added for it rather than cutting answers short.
        max_tokens: (opts.maxTokens ?? 4000) + THINKING_ROOM[opts.effort ?? "medium"],
        thinking: { type: "adaptive" },
        output_config: { effort: opts.effort ?? "medium" },
        ...(opts.system ? { system: opts.system } : {}),
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: { type: "auto" as const } } : {}),
        messages: opts.messages,
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      }, { timeout: opts.timeoutMs ?? 60_000 });
      await this.record(opts, res.usage, Date.now() - started, res.stop_reason !== "refusal");
      if (res.stop_reason === "refusal") throw new Error("The request was declined");
      return res;
    } catch (e) {
      if (!(e instanceof Error && e.message === "The request was declined")) await this.record(opts, null, Date.now() - started, false);
      if (e instanceof Anthropic.RateLimitError) this.log.warn(`${opts.feature}: Claude rate limit`);
      else if (e instanceof Anthropic.APIError) this.log.warn(`${opts.feature}: Claude ${e.status} ${e.message.slice(0, 160)}`);
      throw e;
    }
  }

  private async checkQuota(userId?: string) {
    if (!userId) return;
    const day = new Date().toISOString().slice(0, 10);
    const k = `ai:quota:${userId}:${day}`;
    const n = await this.redis.incr(k).catch(() => 0);
    if (n === 1) await this.redis.expire(k, 86_400).catch(() => {});
    if (n > DAILY_LIMIT) throw new HttpException("You’ve reached today’s AI limit. It resets at midnight.", HttpStatus.TOO_MANY_REQUESTS);
  }

  private async record(opts: AskOptions, usage: { input_tokens?: number | null; output_tokens?: number | null } | null, ms: number, ok: boolean) {
    try {
      await this.db.insert(aiUsage).values({
        id: newId(), userId: opts.userId ?? null, feature: opts.feature.slice(0, 40), model: this.model,
        inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0, ms, ok,
      });
    } catch { /* usage tracking must never break a request */ }
  }
}

/** The answer text of a response (thinking and tool calls left out). */
export function textOf(res: Anthropic.Beta.BetaMessage) {
  return res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
}
