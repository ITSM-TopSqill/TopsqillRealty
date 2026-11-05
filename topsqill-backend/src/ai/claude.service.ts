import { Injectable, Inject, Logger, HttpException, HttpStatus } from "@nestjs/common";
import Redis from "ioredis";
import { createHash } from "node:crypto";
import { DB, type Database } from "../db/db.module";
import { REDIS } from "../redis/redis.module";
import { aiUsage } from "../db/schema";
import { newId } from "../common/ids";
import { env } from "../common/env";

type AskOptions = {
  userId?: string;
  feature: string;
  maxTokens?: number;
  system?: string;
  images?: { base64: string; mediaType: string }[];
  cacheSeconds?: number;
  timeoutMs?: number;
};

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 200);   // AI calls per member per day

/**
 * The only place that talks to Claude.
 *
 * The API key stays on the server, every call is rate limited per member,
 * identical prompts are cached, failures never crash a request, and usage is
 * recorded so cost can be tracked per feature.
 */
@Injectable()
export class ClaudeService {
  private readonly log = new Logger("claude");

  constructor(@Inject(DB) private readonly db: Database, @Inject(REDIS) private readonly redis: Redis) {}

  get available() { return !!env.ANTHROPIC_API_KEY; }

  /** Asks for JSON and falls back to the supplied value if anything goes wrong. */
  async json<T>(prompt: string, fallback: () => T, opts: AskOptions): Promise<{ data: T; source: "claude" | "rules" }> {
    if (!this.available) return { data: fallback(), source: "rules" };
    try {
      const text = await this.ask(prompt, opts);
      const cleaned = text.replace(/```json|```/g, "").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      const parsed = JSON.parse(start >= 0 ? cleaned.slice(start, end + 1) : cleaned) as T;
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      return { data: parsed, source: "claude" };
    } catch (e) {
      this.log.warn(`${opts.feature}: falling back to rules (${(e as Error).message})`);
      return { data: fallback(), source: "rules" };
    }
  }

  async ask(prompt: string, opts: AskOptions): Promise<string> {
    if (!this.available) throw new Error("AI is not configured");
    await this.checkQuota(opts.userId);

    const key = `ai:${createHash("sha256").update(opts.feature + "|" + prompt + "|" + (opts.system ?? "")).digest("hex").slice(0, 32)}`;
    if (opts.cacheSeconds && !opts.images) {
      const hit = await this.redis.get(key).catch(() => null);
      if (hit) return hit;
    }

    const content: unknown[] = [];
    for (const img of opts.images ?? []) {
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    }
    content.push({ type: "text", text: prompt });

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: env.CLAUDE_MODEL,
          max_tokens: opts.maxTokens ?? 1500,
          ...(opts.system ? { system: opts.system } : {}),
          messages: [{ role: "user", content }],
        }),
      });
      if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      await this.record(opts, body.usage ?? null, Date.now() - started, true);
      if (opts.cacheSeconds && !opts.images) await this.redis.set(key, text, "EX", opts.cacheSeconds).catch(() => {});
      return text;
    } catch (e) {
      await this.record(opts, null, Date.now() - started, false);
      throw e;
    } finally { clearTimeout(timer); }
  }

  private async checkQuota(userId?: string) {
    if (!userId) return;
    const day = new Date().toISOString().slice(0, 10);
    const k = `ai:quota:${userId}:${day}`;
    const n = await this.redis.incr(k).catch(() => 0);
    if (n === 1) await this.redis.expire(k, 86_400).catch(() => {});
    if (n > DAILY_LIMIT) throw new HttpException("You’ve reached today’s AI limit. It resets at midnight.", HttpStatus.TOO_MANY_REQUESTS);
  }

  private async record(opts: AskOptions, usage: { input_tokens?: number; output_tokens?: number } | null, ms: number, ok: boolean) {
    try {
      await this.db.insert(aiUsage).values({
        id: newId(), userId: opts.userId ?? null, feature: opts.feature, model: env.CLAUDE_MODEL,
        inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0, ms, ok,
      });
    } catch { /* usage tracking must never break a request */ }
  }
}
