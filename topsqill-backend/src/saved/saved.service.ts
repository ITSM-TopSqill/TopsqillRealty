import { Injectable, Inject } from "@nestjs/common";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { savedItems, listings, users, media } from "../db/schema";
import { MediaService } from "../media/media.service";

const TYPES = ["listing", "profile", "project", "job"] as const;
export type SavedType = (typeof TYPES)[number];

@Injectable()
export class SavedService {
  constructor(@Inject(DB) private readonly db: Database, @Inject(DB_READ) private readonly read: Database, private readonly mediaSvc: MediaService) {}

  /** Is this item saved by me? (For the heart on a listing.) */
  async isSaved(userId: string, itemType: SavedType, itemId: string) {
    const [row] = await this.read.select({ itemId: savedItems.itemId }).from(savedItems)
      .where(and(eq(savedItems.userId, userId), eq(savedItems.itemType, itemType), eq(savedItems.itemId, itemId))).limit(1);
    return { saved: !!row };
  }

  async save(userId: string, itemType: SavedType, itemId: string) {
    const res = await this.db.insert(savedItems).values({ userId, itemType, itemId }).onConflictDoNothing().returning();
    if (res.length && itemType === "listing") {
      await this.db.update(listings).set({ saveCount: sql`${listings.saveCount} + 1` }).where(eq(listings.id, itemId));
    }
    return { ok: true, saved: true };
  }

  async unsave(userId: string, itemType: SavedType, itemId: string) {
    const res = await this.db.delete(savedItems)
      .where(and(eq(savedItems.userId, userId), eq(savedItems.itemType, itemType), eq(savedItems.itemId, itemId))).returning();
    if (res.length && itemType === "listing") {
      await this.db.update(listings).set({ saveCount: sql`greatest(${listings.saveCount} - 1, 0)` }).where(eq(listings.id, itemId));
    }
    return { ok: true, saved: false };
  }

  /** Saved items, with the listing or profile details attached in one extra query. */
  async list(userId: string, itemType: SavedType = "listing", limit = 50) {
    const saved = await this.read.select({ itemId: savedItems.itemId, createdAt: savedItems.createdAt })
      .from(savedItems).where(and(eq(savedItems.userId, userId), eq(savedItems.itemType, itemType)))
      .orderBy(desc(savedItems.createdAt)).limit(Math.min(limit, 100));
    if (!saved.length) return { items: [] };
    const ids = saved.map((s) => s.itemId);

    if (itemType === "listing") {
      const rows = await this.read.select({
        id: listings.id, title: listings.title, priceInr: listings.priceInr, purpose: listings.purpose,
        bhk: listings.bhk, areaSqft: listings.areaSqft, city: listings.city, locality: listings.locality,
        coverMediaId: listings.coverMediaId, status: listings.status, kind: listings.kind,
        previousPriceInr: listings.previousPriceInr, priceDroppedAt: listings.priceDroppedAt, verified: listings.verified,
        ownerId: listings.ownerId, publishedAt: listings.publishedAt, possession: listings.possession,
      }).from(listings).where(inArray(listings.id, ids));
      const coverIds = rows.map((r) => r.coverMediaId).filter(Boolean) as string[];
      const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
      const [covers, owners] = await Promise.all([
        coverIds.length ? this.read.select().from(media).where(inArray(media.id, coverIds)) : Promise.resolve([]),
        ownerIds.length ? this.read.select({ id: users.id, name: users.name, type: users.type, avatarMediaId: users.avatarMediaId, kycVerified: users.kycVerified }).from(users).where(inArray(users.id, ownerIds)) : Promise.resolve([]),
      ]);
      const coverById = new Map(covers.map((m) => [m.id, this.mediaSvc.publicView(m)]));
      const ownerById = new Map(owners.map((o) => [o.id, o]));
      const byId = new Map(rows.map((r) => [r.id, { ...r, cover: r.coverMediaId ? coverById.get(r.coverMediaId) ?? null : null, owner: ownerById.get(r.ownerId) ?? null }]));
      return { items: saved.map((s) => byId.get(s.itemId) ? { ...byId.get(s.itemId)!, savedAt: s.createdAt } : null).filter(Boolean) };
    }
    if (itemType === "profile") {
      const rows = await this.read.select({
        id: users.id, name: users.name, type: users.type, headline: users.headline, city: users.city, avatarMediaId: users.avatarMediaId,
      }).from(users).where(inArray(users.id, ids));
      const byId = new Map(rows.map((r) => [r.id, r]));
      return { items: saved.map((s) => byId.get(s.itemId)).filter(Boolean) };
    }
    return { items: saved };
  }
}
