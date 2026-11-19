import { Injectable, Inject, Logger, BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { facebookAccounts } from "../db/schema";
import { SecretsService } from "./secrets.service";
import { MediaService } from "../media/media.service";
import { CacheService } from "../redis/redis.module";
import { safeFetch } from "../common/safe-fetch";
import { env } from "../common/env";

const GRAPH = "https://graph.facebook.com/v23.0";

export type FbItem = { id: string; type: "image" | "video"; url: string; thumb: string; caption: string; at: string };

/**
 * The member's own Facebook Page, through standard Facebook Login
 * (pages_show_list, pages_read_engagement). They connect once, then pick
 * photos and videos from their Page's posts for a listing; the picked files
 * are copied into their Topsqill media. Uses the same Meta app as WhatsApp
 * Embedded Signup (META_APP_ID / META_APP_SECRET) - no separate app needed.
 */
@Injectable()
export class FacebookService {
  private readonly log = new Logger("facebook");

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly secrets: SecretsService,
    private readonly mediaSvc: MediaService,
    private readonly cache: CacheService,
  ) {}

  get configured() { return !!env.META_APP_ID && !!env.META_APP_SECRET; }
  private get redirectUri() { return `${env.WEB_URL.replace(/\/$/, "")}/api/facebook/callback`; }

  async status(userId: string) {
    if (!this.configured) return { configured: false, connected: false, pageName: null };
    const [row] = await this.read.select({ pageName: facebookAccounts.pageName }).from(facebookAccounts).where(eq(facebookAccounts.ownerId, userId)).limit(1);
    return { configured: true, connected: !!row, pageName: row?.pageName ?? null };
  }

  /** Facebook's login dialog. The state ties the answer to this member for 10 minutes. */
  async authorizeUrl(userId: string) {
    if (!this.configured) throw new ServiceUnavailableException("Facebook isn't set up on Topsqill yet.");
    const state = randomBytes(18).toString("base64url");
    await this.cache.redis.set(`fbstate:${state}`, userId, "EX", 600);
    const q = new URLSearchParams({
      client_id: env.META_APP_ID!, redirect_uri: this.redirectUri, response_type: "code",
      scope: "pages_show_list,pages_read_engagement", state,
    });
    return { url: `https://www.facebook.com/v23.0/dialog/oauth?${q}` };
  }

  /** Facebook sent the member back with a code: swap it for a long-lived token, then pick their first Page. */
  async connect(userId: string, code: string, state: string) {
    const owner = await this.cache.redis.get(`fbstate:${state}`).catch(() => null);
    if (!owner || owner !== userId) throw new BadRequestException("That Facebook sign-in expired. Please try connecting again.");
    await this.cache.redis.del(`fbstate:${state}`).catch(() => {});

    const tokenQ = new URLSearchParams({ client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, redirect_uri: this.redirectUri, code });
    const short = (await (await fetch(`${GRAPH}/oauth/access_token?${tokenQ}`)).json()) as { access_token?: string; error?: { message?: string } };
    if (!short.access_token) throw new BadRequestException(`Facebook didn't connect: ${short.error?.message ?? "no token"}.`);

    const longQ = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, fb_exchange_token: short.access_token });
    const long = (await (await fetch(`${GRAPH}/oauth/access_token?${longQ}`)).json()) as { access_token?: string };
    const userToken = long.access_token ?? short.access_token;

    const pages = (await (await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`)).json()) as
      { data?: { id: string; name: string; access_token: string }[]; error?: { message?: string } };
    const page = pages.data?.[0];
    if (!page) throw new BadRequestException("No Facebook Page found on your account. Create a Facebook Page for your business first, then connect it here.");

    const secretRef = await this.secrets.put(`fb-${userId}`, page.access_token);
    const row = { pageId: page.id, pageName: page.name, secretRef, updatedAt: new Date() };
    await this.db.insert(facebookAccounts).values({ ownerId: userId, ...row })
      .onConflictDoUpdate({ target: facebookAccounts.ownerId, set: row });
    return { connected: true, pageName: row.pageName };
  }

  async disconnect(userId: string) {
    const [row] = await this.read.select({ secretRef: facebookAccounts.secretRef }).from(facebookAccounts).where(eq(facebookAccounts.ownerId, userId)).limit(1);
    if (row) await this.secrets.remove(row.secretRef).catch(() => {});
    await this.db.delete(facebookAccounts).where(eq(facebookAccounts.ownerId, userId));
    return { connected: false };
  }

  /** The member's Page photos and videos, newest first, as pickable items. */
  async media(userId: string): Promise<{ items: FbItem[] }> {
    const { token, pageId } = await this.page(userId);
    const [photos, videos] = await Promise.all([
      fetch(`${GRAPH}/${pageId}/photos?type=uploaded&fields=id,images,name,created_time&limit=24&access_token=${encodeURIComponent(token)}`).then((r) => r.json()),
      fetch(`${GRAPH}/${pageId}/videos?fields=id,picture,description,created_time&limit=24&access_token=${encodeURIComponent(token)}`).then((r) => r.json()),
    ]) as [{ data?: { id: string; images?: { source: string }[]; name?: string; created_time?: string }[] }, { data?: { id: string; picture?: string; description?: string; created_time?: string }[] }];

    const items: FbItem[] = [
      ...(photos.data ?? []).filter((p) => p.images?.length).map((p) => ({
        id: p.id, type: "image" as const, url: p.images![0].source, thumb: p.images![p.images!.length - 1].source,
        caption: (p.name ?? "").slice(0, 140), at: p.created_time ?? "",
      })),
      ...(videos.data ?? []).map((v) => ({
        id: v.id, type: "video" as const, url: v.picture ?? "", thumb: v.picture ?? "",
        caption: (v.description ?? "").slice(0, 140), at: v.created_time ?? "",
      })),
    ].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    return { items };
  }

  /**
   * Copies the picked photos and videos into the member's Topsqill media.
   * Each one is looked up again with the Page's own token (never a link the
   * browser sent), so only this Page's media can be copied.
   */
  async import(userId: string, ids: string[]) {
    const { token } = await this.page(userId);
    const items: { id: string; mediaId?: string; kind?: string; error?: string }[] = [];
    for (const id of [...new Set(ids)].slice(0, 20)) {
      try {
        const node = (await (await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=images,source&access_token=${encodeURIComponent(token)}`)).json()) as
          { images?: { source: string }[]; source?: string; error?: { message?: string } };
        const video = !!node.source;
        const fileUrl = video ? node.source : node.images?.[0]?.source;
        if (!fileUrl) throw new Error(node.error?.message ?? "not a photo or video");
        const file = await safeFetch(fileUrl, { maxBytes: video ? 200e6 : 25e6, timeoutMs: video ? 120_000 : 30_000, accept: video ? "video/*" : "image/*" });
        const saved = await this.mediaSvc.storeOwn(userId, file.body, video ? "video/mp4" : file.contentType, "facebook");
        items.push({ id, mediaId: saved.mediaId, kind: saved.kind });
      } catch (e) {
        items.push({ id, error: (e as Error).message.slice(0, 160) });
      }
    }
    return { items };
  }

  private async page(userId: string) {
    const [row] = await this.read.select().from(facebookAccounts).where(eq(facebookAccounts.ownerId, userId)).limit(1);
    if (!row) throw new BadRequestException("Connect your Facebook Page first.");
    const token = await this.secrets.get(row.secretRef);
    if (!token) throw new BadRequestException("Your Facebook connection was lost. Please connect again.");
    return { token, pageId: row.pageId };
  }
}
