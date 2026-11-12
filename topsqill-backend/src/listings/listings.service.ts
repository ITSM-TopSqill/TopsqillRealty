import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { videoEmbed, tourEmbed } from "../common/embeds";
import { and, eq, lt, or, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { listings, listingMedia, media, users, savedItems } from "../db/schema";
import { NotificationsService } from "../notifications/notifications.service";
import { inr } from "../ai/query";
import { CacheService } from "../redis/redis.module";
import { MediaService } from "../media/media.service";
import { QueueService, QUEUES } from "../queue/queue.module";
import { newId, encodeCursor, decodeCursor } from "../common/ids";

export type SearchQuery = {
  city?: string; locality?: string; purpose?: "sale" | "rent"; kind?: string;
  bhk?: number; minPrice?: number; maxPrice?: number; possession?: string;
  ownerId?: string; cursor?: string; limit?: number;
};

/** The listing fields an owner may edit after publishing. */
export const LISTING_EDITABLE = [
  "title", "purpose", "kind", "city", "locality", "bhk", "areaSqft", "priceInr",
  "possession", "furnishing", "facing", "description", "amenities", "usps", "status",
  "lat", "lng", "locationExact", "videoUrl", "tourUrl", "reraNumber",
] as const;

/**
 * Video and tour links are stored in their standard form, or refused: a
 * listing page frames them, so only known video and 3D-tour hosts are allowed.
 * An empty string clears the link.
 */
/** A price cut shows a "Price drop" badge; a rise clears it. */
export function priceChange(before: number | null | undefined, after: number | null | undefined): "drop" | "rise" | null {
  if (!before || !after || before === after) return null;
  return after < before ? "drop" : "rise";
}

export function cleanLinks<T extends { videoUrl?: string | null; tourUrl?: string | null; lat?: number | null; lng?: number | null }>(input: T): T {
  const out = { ...input };
  if (out.videoUrl !== undefined) {
    if (!out.videoUrl) out.videoUrl = null;
    else out.videoUrl = videoEmbed(out.videoUrl)?.url ?? (() => { throw new BadRequestException("Use a YouTube or Vimeo link for the video."); })();
  }
  if (out.tourUrl !== undefined) {
    if (!out.tourUrl) out.tourUrl = null;
    else out.tourUrl = tourEmbed(out.tourUrl)?.url ?? (() => { throw new BadRequestException("Use a Matterport, Kuula, Momento360, CloudPano or 360° YouTube link for the 3D tour."); })();
  }
  // A location needs both halves.
  if ((out.lat == null) !== (out.lng == null)) { out.lat = null; out.lng = null; }
  return out;
}
export type ListingPatch = Partial<Pick<typeof listings.$inferInsert, (typeof LISTING_EDITABLE)[number]>>;

@Injectable()
export class ListingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly cache: CacheService,
    private readonly mediaSvc: MediaService,
    private readonly queue: QueueService,
    private readonly notifs: NotificationsService,
  ) {}

  /**
   * Search uses keyset pagination, so page 100 is as fast as page 1.
   * Offset pagination would make Postgres read and throw away every earlier row.
   */
  async search(q: SearchQuery) {
    // Identical searches are common (the same city and filters from many users),
    // so the whole result is cached for 30 seconds. The CDN caches it too.
    const key = `search:${JSON.stringify([q.city, q.locality, q.purpose, q.kind, q.bhk, q.minPrice, q.maxPrice, q.possession, q.ownerId, q.cursor, q.limit])}`;
    return this.cache.wrap(key, 30, () => this.searchUncached(q));
  }

  private async searchUncached(q: SearchQuery) {
    const limit = Math.min(Math.max(q.limit ?? 24, 1), 50);
    const cur = decodeCursor(q.cursor);
    // Hidden listings (moderated, or owned by a suspended member) never appear in search.
    const where = [eq(listings.status, "active"), eq(listings.hidden, false)];
    if (q.city) where.push(eq(listings.city, q.city));
    if (q.locality) where.push(eq(listings.locality, q.locality));
    if (q.purpose) where.push(eq(listings.purpose, q.purpose));
    if (q.kind) where.push(eq(listings.kind, q.kind));
    if (q.bhk) where.push(q.bhk >= 5 ? gte(listings.bhk, 5) : eq(listings.bhk, q.bhk));
    if (q.minPrice) where.push(gte(listings.priceInr, q.minPrice));
    if (q.maxPrice) where.push(lte(listings.priceInr, q.maxPrice));
    if (q.possession) where.push(eq(listings.possession, q.possession));
    if (q.ownerId) where.push(eq(listings.ownerId, q.ownerId));
    if (cur) {
      where.push(or(
        lt(listings.publishedAt, new Date(cur.t)),
        and(eq(listings.publishedAt, new Date(cur.t)), lt(listings.id, cur.id))!,
      )!);
    }

    // Only the columns the result card shows. No SELECT *, so less data crosses the network.
    const rows = await this.read.select({
      id: listings.id, title: listings.title, purpose: listings.purpose, kind: listings.kind,
      bhk: listings.bhk, areaSqft: listings.areaSqft, priceInr: listings.priceInr,
      city: listings.city, locality: listings.locality, possession: listings.possession,
      verified: listings.verified, coverMediaId: listings.coverMediaId,
      publishedAt: listings.publishedAt, ownerId: listings.ownerId,
      previousPriceInr: listings.previousPriceInr, priceDroppedAt: listings.priceDroppedAt,
    }).from(listings).where(and(...where))
      .orderBy(desc(listings.publishedAt), desc(listings.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Covers and owners are fetched in one query each (never one per row).
    const [covers, owners] = await Promise.all([
      this.coversFor(page.map((r) => r.coverMediaId).filter(Boolean) as string[]),
      this.ownersFor([...new Set(page.map((r) => r.ownerId))]),
    ]);

    return {
      items: page.map((r) => ({
        ...r,
        cover: r.coverMediaId ? covers.get(r.coverMediaId) ?? null : null,
        owner: owners.get(r.ownerId) ?? null,
      })),
      nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1].publishedAt!, page[page.length - 1].id) : null,
    };
  }

  private async coversFor(ids: string[]) {
    const map = new Map<string, unknown>();
    if (!ids.length) return map;
    const rows = await this.read.select().from(media).where(inArray(media.id, ids));
    for (const m of rows) map.set(m.id, this.mediaSvc.publicView(m));
    return map;
  }

  private async ownersFor(ids: string[]) {
    const map = new Map<string, unknown>();
    if (!ids.length) return map;
    const rows = await this.read.select({
      id: users.id, name: users.name, type: users.type, kycVerified: users.kycVerified,
      reraVerified: users.reraVerified, avatarMediaId: users.avatarMediaId,
    }).from(users).where(inArray(users.id, ids));
    for (const u of rows) map.set(u.id, u);
    return map;
  }

  /** A single listing, cached for a minute: this is the most-opened screen in the app. */
  async getById(id: string) {
    return this.cache.wrap(`listing:${id}`, 60, async () => {
      const [row] = await this.read.select().from(listings).where(eq(listings.id, id)).limit(1);
      // Hidden and draft listings are not public. Sold and archived ones stay
      // viewable, so shared links do not break once a deal closes.
      if (!row || row.hidden || row.status === "draft" || row.status === "pending") {
        throw new NotFoundException("That listing is no longer available.");
      }
      const [mediaRows, owner] = await Promise.all([
        this.read.select({ m: media, position: listingMedia.position })
          .from(listingMedia).innerJoin(media, eq(media.id, listingMedia.mediaId))
          .where(eq(listingMedia.listingId, id)).orderBy(listingMedia.position),
        this.ownersFor([row.ownerId]),
      ]);
      // Where an imported listing came from is kept for audit, never shown publicly.
      const { sourceUrl: _source, ...pub } = row;
      return { ...pub, media: mediaRows.map((r) => this.mediaSvc.publicView(r.m)), owner: owner.get(row.ownerId) ?? null };
    });
  }

  async mine(userId: string) {
    const rows = await this.read.select({
      id: listings.id, title: listings.title, status: listings.status, purpose: listings.purpose,
      kind: listings.kind, bhk: listings.bhk, areaSqft: listings.areaSqft, priceInr: listings.priceInr,
      city: listings.city, locality: listings.locality, publishedAt: listings.publishedAt,
      viewCount: listings.viewCount, leadCount: listings.leadCount,
      possession: listings.possession, coverMediaId: listings.coverMediaId, ownerId: listings.ownerId,
      previousPriceInr: listings.previousPriceInr, priceDroppedAt: listings.priceDroppedAt,
    }).from(listings).where(eq(listings.ownerId, userId)).orderBy(desc(listings.createdAt)).limit(100);
    const covers = await this.coversFor(rows.map((r) => r.coverMediaId).filter(Boolean) as string[]);
    return { items: rows.map((r) => ({ ...r, cover: r.coverMediaId ? covers.get(r.coverMediaId) ?? null : null })) };
  }

  /** Everything the edit screen needs, in any state. Only for the owner. */
  async forEdit(userId: string, id: string) {
    const [row] = await this.read.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!row) throw new NotFoundException("That listing is no longer available.");
    if (row.ownerId !== userId) throw new ForbiddenException("You can only edit your own listings.");
    const mediaRows = await this.read.select({ m: media }).from(listingMedia)
      .innerJoin(media, eq(media.id, listingMedia.mediaId))
      .where(eq(listingMedia.listingId, id)).orderBy(listingMedia.position);
    return { ...row, media: mediaRows.map((r) => this.mediaSvc.publicView(r.m)) };
  }

  /** Only the member's own, public photos and videos: never someone else's files, and never a private document. */
  private async ownMedia(userId: string, requested: string[]) {
    if (!requested.length) return [];
    const owned = await this.read.select({ id: media.id, ownerId: media.ownerId, groupName: media.groupName }).from(media).where(inArray(media.id, requested));
    const allowed = new Set(owned.filter((m) => m.ownerId === userId && m.groupName !== "private").map((m) => m.id));
    return [...new Set(requested.filter((m) => allowed.has(m)))];
  }

  async create(userId: string, input: Partial<typeof listings.$inferInsert> & { mediaIds?: string[] }) {
    const id = newId();
    const { mediaIds: requested = [], ...rest } = cleanLinks(input);
    const mediaIds = await this.ownMedia(userId, requested);
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx.insert(listings).values({
        ...rest, id, ownerId: userId,
        status: rest.status ?? "active",
        publishedAt: (rest.status ?? "active") === "active" ? new Date() : null,
        coverMediaId: rest.coverMediaId ?? mediaIds[0] ?? null,
      } as typeof listings.$inferInsert).returning();
      if (mediaIds.length) {
        await tx.insert(listingMedia).values(mediaIds.map((mediaId, position) => ({ listingId: id, mediaId, position })));
      }
      await tx.update(users).set({ listingCount: sql`${users.listingCount} + 1` }).where(eq(users.id, userId));
      return created;
    });
    // Buyers whose requirements match this listing are matched in the background.
    if (row.status === "active") await this.queue.add(QUEUES.ai, "match:listing", { listingId: row.id }, `matchl-${row.id}`);
    return row;
  }

  /**
   * How prices have moved in this listing's locality over the last 12 months,
   * next to this listing's own price: the median rate per sq ft (for sale) or
   * median rent for the same bedrooms (for rent), month by month, with the
   * whole city as a second line. Months with no listings are left out.
   */
  async priceTrend(id: string) {
    return this.cache.wrap(`trend:${id}`, 3600, async () => {
      const [l] = await this.read.select().from(listings).where(eq(listings.id, id)).limit(1);
      if (!l || l.hidden) throw new NotFoundException("That listing is no longer available.");
      const sale = l.purpose === "sale";
      const metric = sale
        ? sql<number>`percentile_cont(0.5) within group (order by ${listings.priceInr}::numeric / nullif(${listings.areaSqft}, 0))`
        : sql<number>`percentile_cont(0.5) within group (order by ${listings.priceInr})`;
      const month = sql<string>`to_char(date_trunc('month', coalesce(${listings.publishedAt}, ${listings.createdAt})), 'YYYY-MM')`;
      const base = [
        // Other listings only: a home is never compared with itself.
        sql`${listings.id} <> ${l.id}`,
        eq(listings.purpose, l.purpose), eq(listings.hidden, false), sql`lower(${listings.city}) = lower(${l.city})`,
        sql`coalesce(${listings.publishedAt}, ${listings.createdAt}) > date_trunc('month', now()) - interval '11 months'`,
        sql`${listings.priceInr} > 0`, ...(sale ? [sql`${listings.areaSqft} > 0`] : l.bhk ? [eq(listings.bhk, l.bhk)] : []),
      ];
      const series = (extra: ReturnType<typeof sql>[]) => this.read.select({ month, value: metric, n: sql<number>`count(*)::int` })
        .from(listings).where(and(...base, ...extra)).groupBy(month).orderBy(month);
      const [locality, city] = await Promise.all([series([sql`lower(${listings.locality}) = lower(${l.locality})`]), series([])]);
      const round = (rows: { month: string; value: number; n: number }[]) => rows.map((r) => ({ month: r.month, value: Math.round(Number(r.value)), n: r.n }));
      const own = sale ? (l.priceInr && l.areaSqft ? Math.round(l.priceInr / l.areaSqft) : null) : l.priceInr ?? null;
      const loc = round(locality);
      const last = loc.length ? loc[loc.length - 1].value : null;
      const first = loc.length > 1 ? loc[0].value : null;
      return {
        locality: l.locality, city: l.city, unit: sale ? "per sq ft" : `a month${l.bhk ? ` (${l.bhk} BHK)` : ""}`,
        listing: own, localitySeries: loc, citySeries: round(city),
        changePct: first && last ? Math.round(((last - first) / first) * 1000) / 10 : null,
        // Only against a real median: at least two other homes in the latest month.
        vsLocalityPct: own && last && loc[loc.length - 1].n >= 2 ? Math.round(((own - last) / last) * 1000) / 10 : null,
      };
    });
  }

  /** Everyone who saved this home hears about a price cut. */
  private async alertSavers(listingId: string, title: string, from: number, to: number) {
    const savers = await this.read.select({ userId: savedItems.userId }).from(savedItems)
      .where(and(eq(savedItems.itemType, "listing"), eq(savedItems.itemId, listingId))).limit(500);
    for (const s of savers) {
      await this.notifs.create({
        userId: s.userId, kind: "match", title: `Price drop: ${title}`.slice(0, 140),
        body: `Now ${inr(to)}, down from ${inr(from)}.`, targetType: "listing", targetId: listingId,
      }).catch(() => null);
    }
  }

  async update(userId: string, id: string, patch: ListingPatch & { mediaIds?: string[] }) {
    const [existing] = await this.db.select({ ownerId: listings.ownerId, publishedAt: listings.publishedAt, status: listings.status, priceInr: listings.priceInr, title: listings.title })
      .from(listings).where(eq(listings.id, id)).limit(1);
    if (!existing) throw new NotFoundException("That listing is no longer available.");
    if (existing.ownerId !== userId) throw new ForbiddenException("You can only edit your own listings.");

    // Only fields an owner may change. Flags such as `verified`, `hidden`, the
    // counters and the owner itself are set by the platform, never by the member.
    patch = cleanLinks(patch);
    const data: Record<string, unknown> = {};
    for (const k of LISTING_EDITABLE) if (k in patch && (patch as Record<string, unknown>)[k] !== undefined) data[k] = (patch as Record<string, unknown>)[k];
    if (data.status === "active" && !existing.publishedAt) data.publishedAt = new Date();
    data.updatedAt = new Date();
    // A lower price shows a "Price drop" badge for 30 days; raising it again removes the badge.
    const newPrice = typeof data.priceInr === "number" ? data.priceInr : null;
    const change = priceChange(existing.priceInr, newPrice);
    const dropped = change === "drop";
    if (dropped) { data.previousPriceInr = existing.priceInr; data.priceDroppedAt = new Date(); }
    else if (change === "rise") { data.previousPriceInr = null; data.priceDroppedAt = null; }

    // Photos: the list sent replaces the old one, in that order; the first is the cover.
    const mediaIds = patch.mediaIds ? await this.ownMedia(userId, patch.mediaIds) : null;
    if (mediaIds) data.coverMediaId = mediaIds[0] ?? null;

    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx.update(listings).set(data as Partial<typeof listings.$inferInsert>).where(eq(listings.id, id)).returning();
      if (mediaIds) {
        await tx.delete(listingMedia).where(eq(listingMedia.listingId, id));
        if (mediaIds.length) await tx.insert(listingMedia).values(mediaIds.map((mediaId, position) => ({ listingId: id, mediaId, position })));
      }
      return updated;
    });
    await this.cache.invalidate(`listing:${id}`);
    if (dropped && row.status === "active") await this.alertSavers(id, existing.title, existing.priceInr!, newPrice!).catch(() => null);
    // A live listing whose price, place or size changed may now suit different buyers.
    const rematch = ["priceInr", "city", "locality", "bhk", "areaSqft", "purpose", "kind", "possession"].some((k) => k in data);
    if (row.status === "active" && (rematch || existing.status !== "active")) {
      await this.queue.add(QUEUES.ai, "match:listing", { listingId: id }, `matchl-${id}-${Date.now()}`);
    }
    return row;
  }

  /** View counts are buffered in Redis and written to Postgres in batches by a worker. */
  async recordView(id: string) {
    await this.cache.redis.hincrby("listing:views", id, 1).catch(() => {});
    return { ok: true };
  }
}
