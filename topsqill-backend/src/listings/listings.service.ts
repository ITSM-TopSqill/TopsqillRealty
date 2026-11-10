import { Injectable, Inject, NotFoundException, ForbiddenException } from "@nestjs/common";
import { and, eq, lt, or, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { listings, listingMedia, media, users } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { MediaService } from "../media/media.service";
import { QueueService, QUEUES } from "../queue/queue.module";
import { newId, encodeCursor, decodeCursor } from "../common/ids";

export type SearchQuery = {
  city?: string; locality?: string; purpose?: "sale" | "rent"; kind?: string;
  bhk?: number; minPrice?: number; maxPrice?: number; possession?: string;
  cursor?: string; limit?: number;
};

/** The listing fields an owner may edit after publishing. */
export const LISTING_EDITABLE = [
  "title", "purpose", "kind", "city", "locality", "bhk", "areaSqft", "priceInr",
  "possession", "furnishing", "facing", "description", "amenities", "usps", "status",
] as const;
export type ListingPatch = Partial<Pick<typeof listings.$inferInsert, (typeof LISTING_EDITABLE)[number]>>;

@Injectable()
export class ListingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly cache: CacheService,
    private readonly mediaSvc: MediaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Search uses keyset pagination, so page 100 is as fast as page 1.
   * Offset pagination would make Postgres read and throw away every earlier row.
   */
  async search(q: SearchQuery) {
    // Identical searches are common (the same city and filters from many users),
    // so the whole result is cached for 30 seconds. The CDN caches it too.
    const key = `search:${JSON.stringify([q.city, q.locality, q.purpose, q.kind, q.bhk, q.minPrice, q.maxPrice, q.possession, q.cursor, q.limit])}`;
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
      return { ...row, media: mediaRows.map((r) => this.mediaSvc.publicView(r.m)), owner: owner.get(row.ownerId) ?? null };
    });
  }

  async mine(userId: string) {
    const rows = await this.read.select({
      id: listings.id, title: listings.title, status: listings.status, purpose: listings.purpose,
      kind: listings.kind, bhk: listings.bhk, areaSqft: listings.areaSqft, priceInr: listings.priceInr,
      city: listings.city, locality: listings.locality, publishedAt: listings.publishedAt,
      viewCount: listings.viewCount, leadCount: listings.leadCount,
    }).from(listings).where(eq(listings.ownerId, userId)).orderBy(desc(listings.createdAt)).limit(100);
    return { items: rows };
  }

  async create(userId: string, input: Partial<typeof listings.$inferInsert> & { mediaIds?: string[] }) {
    const id = newId();
    const { mediaIds = [], ...rest } = input;
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

  async update(userId: string, id: string, patch: ListingPatch) {
    const [existing] = await this.db.select({ ownerId: listings.ownerId, publishedAt: listings.publishedAt })
      .from(listings).where(eq(listings.id, id)).limit(1);
    if (!existing) throw new NotFoundException("That listing is no longer available.");
    if (existing.ownerId !== userId) throw new ForbiddenException("You can only edit your own listings.");

    // Only fields an owner may change. Flags such as `verified`, `hidden`, the
    // counters and the owner itself are set by the platform, never by the member.
    const data: Record<string, unknown> = {};
    for (const k of LISTING_EDITABLE) if (k in patch && (patch as Record<string, unknown>)[k] !== undefined) data[k] = (patch as Record<string, unknown>)[k];
    if (data.status === "active" && !existing.publishedAt) data.publishedAt = new Date();
    data.updatedAt = new Date();

    const [row] = await this.db.update(listings).set(data as Partial<typeof listings.$inferInsert>).where(eq(listings.id, id)).returning();
    await this.cache.invalidate(`listing:${id}`);
    return row;
  }

  /** View counts are buffered in Redis and written to Postgres in batches by a worker. */
  async recordView(id: string) {
    await this.cache.redis.hincrby("listing:views", id, 1).catch(() => {});
    return { ok: true };
  }
}
