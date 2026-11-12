import { Injectable, Inject, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DB_READ, type Database } from "../db/db.module";
import { users } from "../db/schema";
import { MediaService } from "../media/media.service";
import { CacheService } from "../redis/redis.module";
import { normalisePhone } from "../auth/phone";
import { env } from "../common/env";

const GRAPH = "https://graph.facebook.com/v23.0";
const MAX_FILE = 100e6;
const PER_DAY = 300;

/**
 * Topsqill's WhatsApp number as a media inbox. A member sends photos and
 * videos of their property from the number they signed in with; each one is
 * downloaded from WhatsApp and added to their Topsqill media, ready to pick
 * into a listing ("From WhatsApp"). They're the member's own files, so
 * nothing is taken from any other site.
 *
 * Senders who aren't members get a short reply on how to join. Replies are
 * sent at most once every two minutes per sender, so ten photos don't bring
 * ten replies.
 */
@Injectable()
export class MediaInboxService {
  private readonly log = new Logger("wa-inbox");

  constructor(
    @Inject(DB_READ) private readonly read: Database,
    private readonly mediaSvc: MediaService,
    private readonly cache: CacheService,
  ) {}

  get configured() { return !!env.WHATSAPP_TOKEN && !!env.WHATSAPP_PHONE_NUMBER_ID; }

  /** True when a webhook is for Topsqill's own number (rather than a member's business number). */
  isOurNumber(phoneNumberId: unknown) { return this.configured && String(phoneNumberId ?? "") === env.WHATSAPP_PHONE_NUMBER_ID; }

  /** The number members send to, as WhatsApp shows it (asked once a day). */
  async number(): Promise<string | null> {
    if (!this.configured) return null;
    const cached = await this.cache.redis.get("wa-inbox:number").catch(() => null);
    if (cached) return cached;
    try {
      const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number`, { headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}` } });
      const j = (await res.json()) as { display_phone_number?: string };
      if (!j.display_phone_number) return null;
      await this.cache.redis.set("wa-inbox:number", j.display_phone_number, "EX", 86_400).catch(() => {});
      return j.display_phone_number;
    } catch { return null; }
  }

  /** The number a member must send from (the one they signed in with). */
  async phoneOf(userId: string) {
    const [u] = await this.read.select({ phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.phone ?? null;
  }

  async receive(value: Record<string, any>) {
    for (const m of value.messages ?? []) {
      const from = normalisePhone(String(m.from ?? ""));
      if (!from) continue;
      const [member] = await this.read.select({ id: users.id }).from(users).where(eq(users.phone, from)).limit(1);
      if (!member) {
        await this.reply(from, "Hi! To add photos and videos to Topsqill, first sign in at topsqill.ai with this WhatsApp number, then send them here again.");
        continue;
      }
      const item = m.type === "image" ? m.image : m.type === "video" ? m.video
        : m.type === "document" && /^(image|video)\//.test(m.document?.mime_type ?? "") ? m.document : null;
      if (!item?.id) {
        await this.reply(from, "Send photos or videos of your property here (as photos, or as documents for full quality). They'll appear in Topsqill under New listing → From WhatsApp.");
        continue;
      }
      const day = `wa-inbox:${member.id}:${new Date().toISOString().slice(0, 10)}`;
      const n = await this.cache.redis.incr(day).catch(() => 0);
      if (n === 1) await this.cache.redis.expire(day, 86_400).catch(() => {});
      if (n > PER_DAY) { await this.reply(from, `You've sent ${PER_DAY} files today, the daily limit. Send the rest tomorrow, or upload them on the website.`); continue; }
      try {
        const file = await this.download(String(item.id));
        await this.mediaSvc.storeOwn(member.id, file.body, file.mime, "whatsapp");
        await this.reply(from, "✅ Got it! It's in your Topsqill media: open New listing (or Edit listing) → From WhatsApp to add it. Send as many as you like.");
      } catch (e) {
        this.log.warn(`couldn't save WhatsApp media from ${from.slice(0, 6)}…: ${(e as Error).message.slice(0, 160)}`);
        await this.reply(from, "Sorry, that file couldn't be saved. Please send a photo or an MP4 video under 100 MB.", true);
      }
    }
    return { ok: true };
  }

  /** WhatsApp gives a media id; its short-lived link needs our token to download. */
  private async download(id: string) {
    const meta = await fetch(`${GRAPH}/${id}`, { headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}` } });
    const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!info.url) throw new Error("no media link");
    if ((info.file_size ?? 0) > MAX_FILE) throw new Error("too large");
    const host = new URL(info.url).hostname;
    if (!/(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net)$/.test(host)) throw new Error(`unexpected media host ${host}`);
    const res = await fetch(info.url, { headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}` } });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_FILE) throw new Error("too large");
    return { body, mime: info.mime_type ?? res.headers.get("content-type") ?? "" };
  }

  /** A text reply (allowed: they've just messaged us). At most one every 2 minutes per sender, unless it's an error. */
  private async reply(to: string, text: string, always = false) {
    if (!always) {
      const first = await this.cache.redis.set(`wa-inbox:ack:${to}`, "1", "EX", 120, "NX").catch(() => "OK");
      if (first !== "OK") return;
    }
    await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace("+", ""), type: "text", text: { body: text } }),
    }).catch((e) => this.log.warn(`reply failed: ${(e as Error).message}`));
  }
}
