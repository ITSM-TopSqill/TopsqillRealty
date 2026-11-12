import { Injectable, Inject, Logger, BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { instagramAccounts } from "../db/schema";
import { SecretsService } from "./secrets.service";
import { MediaService } from "../media/media.service";
import { CacheService } from "../redis/redis.module";
import { safeFetch } from "../common/safe-fetch";
import { env } from "../common/env";

const GRAPH = "https://graph.instagram.com/v23.0";
const FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url,thumbnail_url}";

export type IgItem = { id: string; type: "image" | "video"; url: string; thumb: string; caption: string; permalink: string; at: string };

/** Posts, carousels and reels as single pickable photos and videos (a carousel's slides each become one). */
export function flattenMedia(data: Record<string, any>[]): IgItem[] {
  const out: IgItem[] = [];
  const one = (m: Record<string, any>, parent: Record<string, any>) => {
    const type = m.media_type === "VIDEO" ? "video" : m.media_type === "IMAGE" ? "image" : null;
    if (!type || !m.media_url) return;
    out.push({ id: String(m.id), type, url: m.media_url, thumb: m.thumbnail_url ?? m.media_url, caption: String(parent.caption ?? "").slice(0, 140), permalink: parent.permalink ?? "", at: parent.timestamp ?? "" });
  };
  for (const m of data) {
    if (m.media_type === "CAROUSEL_ALBUM") for (const c of m.children?.data ?? []) one(c, m);
    else one(m, m);
  }
  return out;
}

/**
 * The member's own Instagram, through Instagram's official login (Instagram
 * API with Instagram Login). They connect once, then pick photos and reels
 * from their posts for a listing; the picked files are copied into their
 * Topsqill media. Works with Instagram business and creator accounts (a free
 * switch in Instagram's settings); Instagram doesn't allow this for personal
 * accounts.
 *
 * The token lives in Secret Manager. It lasts 60 days and is renewed
 * automatically when it's used in its last 10 days.
 */
@Injectable()
export class InstagramService {
  private readonly log = new Logger("instagram");

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly secrets: SecretsService,
    private readonly mediaSvc: MediaService,
    private readonly cache: CacheService,
  ) {}

  get configured() { return !!env.INSTAGRAM_APP_ID && !!env.INSTAGRAM_APP_SECRET; }
  private get redirectUri() { return `${env.WEB_URL.replace(/\/$/, "")}/api/instagram/callback`; }

  async status(userId: string) {
    if (!this.configured) return { configured: false, connected: false, username: null };
    const [row] = await this.read.select({ username: instagramAccounts.username }).from(instagramAccounts).where(eq(instagramAccounts.ownerId, userId)).limit(1);
    return { configured: true, connected: !!row, username: row?.username ?? null };
  }

  /** The Instagram login page. The state ties the answer to this member for 10 minutes. */
  async authorizeUrl(userId: string) {
    if (!this.configured) throw new ServiceUnavailableException("Instagram isn't set up on Topsqill yet.");
    const state = randomBytes(18).toString("base64url");
    await this.cache.redis.set(`igstate:${state}`, userId, "EX", 600);
    const q = new URLSearchParams({ client_id: env.INSTAGRAM_APP_ID!, redirect_uri: this.redirectUri, response_type: "code", scope: "instagram_business_basic", state });
    return { url: `https://www.instagram.com/oauth/authorize?${q}` };
  }

  /** Instagram sent the member back with a code: swap it for a 60-day token and save it. */
  async connect(userId: string, code: string, state: string) {
    const owner = await this.cache.redis.get(`igstate:${state}`).catch(() => null);
    if (!owner || owner !== userId) throw new BadRequestException("That Instagram sign-in expired. Please try connecting again.");
    await this.cache.redis.del(`igstate:${state}`).catch(() => {});

    const form = new URLSearchParams({ client_id: env.INSTAGRAM_APP_ID!, client_secret: env.INSTAGRAM_APP_SECRET!, grant_type: "authorization_code", redirect_uri: this.redirectUri, code: code.replace(/#_$/, "") });
    const res = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
    const j = (await res.json()) as { access_token?: string; user_id?: string | number; data?: { access_token: string; user_id: string | number }[]; error_message?: string };
    const short = j.access_token ?? j.data?.[0]?.access_token;
    if (!short) throw new BadRequestException(`Instagram didn't connect: ${j.error_message ?? "no token"}.`);

    const ll = await fetch(`https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: env.INSTAGRAM_APP_SECRET!, access_token: short })}`);
    const long = (await ll.json()) as { access_token?: string; expires_in?: number };
    const token = long.access_token ?? short;
    const me = (await (await fetch(`${GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`)).json()) as { user_id?: string; id?: string; username?: string };

    const secretRef = await this.secrets.put(`ig-${userId}`, token);
    const expiresAt = new Date(Date.now() + (long.expires_in ?? 3600) * 1000);
    const row = { igUserId: String(me.user_id ?? me.id ?? j.user_id ?? j.data?.[0]?.user_id ?? ""), username: me.username ?? null, secretRef, expiresAt, updatedAt: new Date() };
    await this.db.insert(instagramAccounts).values({ ownerId: userId, ...row })
      .onConflictDoUpdate({ target: instagramAccounts.ownerId, set: row });
    return { connected: true, username: row.username };
  }

  async disconnect(userId: string) {
    const [row] = await this.read.select({ secretRef: instagramAccounts.secretRef }).from(instagramAccounts).where(eq(instagramAccounts.ownerId, userId)).limit(1);
    if (row) await this.secrets.remove(row.secretRef).catch(() => {});
    await this.db.delete(instagramAccounts).where(eq(instagramAccounts.ownerId, userId));
    return { connected: false };
  }

  /** The member's posts and reels, newest first, as pickable photos and videos. */
  async media(userId: string, after?: string) {
    const token = await this.token(userId);
    const q = new URLSearchParams({ fields: FIELDS, limit: "24", access_token: token, ...(after ? { after } : {}) });
    const res = await fetch(`${GRAPH}/me/media?${q}`);
    const j = (await res.json()) as { data?: Record<string, any>[]; paging?: { cursors?: { after?: string }; next?: string }; error?: { message?: string } };
    if (!res.ok) throw new BadRequestException(`Instagram: ${j.error?.message ?? "couldn't load your posts"}`);
    return { items: flattenMedia(j.data ?? []), after: j.paging?.next ? j.paging?.cursors?.after ?? null : null };
  }

  /**
   * Copies the picked photos and videos into the member's Topsqill media.
   * Each one is looked up again with the member's own token (never a link the
   * browser sent), so only their own Instagram media can be copied.
   */
  async import(userId: string, ids: string[]) {
    const token = await this.token(userId);
    const items: { id: string; mediaId?: string; kind?: string; error?: string }[] = [];
    for (const id of [...new Set(ids)].slice(0, 20)) {
      try {
        const m = (await (await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=id,media_type,media_url&access_token=${encodeURIComponent(token)}`)).json()) as { media_type?: string; media_url?: string; error?: { message?: string } };
        if (!m.media_url || !["IMAGE", "VIDEO"].includes(m.media_type ?? "")) throw new Error(m.error?.message ?? "not a photo or video");
        const video = m.media_type === "VIDEO";
        const file = await safeFetch(m.media_url, { maxBytes: video ? 200e6 : 25e6, timeoutMs: video ? 120_000 : 30_000, accept: video ? "video/*" : "image/*" });
        const saved = await this.mediaSvc.storeOwn(userId, file.body, video ? "video/mp4" : file.contentType, "instagram");
        items.push({ id, mediaId: saved.mediaId, kind: saved.kind });
      } catch (e) {
        items.push({ id, error: (e as Error).message.slice(0, 160) });
      }
    }
    return { items };
  }

  /** The saved token, renewed when it has under 10 days left. */
  private async token(userId: string) {
    const [row] = await this.read.select().from(instagramAccounts).where(eq(instagramAccounts.ownerId, userId)).limit(1);
    if (!row) throw new BadRequestException("Connect your Instagram first.");
    const token = await this.secrets.get(row.secretRef);
    if (!token) throw new BadRequestException("Your Instagram connection was lost. Please connect again.");
    if (row.expiresAt && row.expiresAt.getTime() - Date.now() < 10 * 86_400_000) {
      try {
        const r = (await (await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`)).json()) as { access_token?: string; expires_in?: number };
        if (r.access_token) {
          await this.secrets.put(`ig-${userId}`, r.access_token);
          await this.db.update(instagramAccounts).set({ expiresAt: new Date(Date.now() + (r.expires_in ?? 5_184_000) * 1000), updatedAt: new Date() }).where(eq(instagramAccounts.ownerId, userId));
          return r.access_token;
        }
      } catch (e) { this.log.warn(`token refresh failed: ${(e as Error).message.slice(0, 120)}`); }
    }
    return token;
  }
}
