import { Injectable, Inject } from "@nestjs/common";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { savedItems, listings, users } from "../db/schema";

const TYPES = ["listing", "profile", "project", "job"] as const;
export type SavedType = (typeof TYPES)[number];

@Injectable()
export class SavedService {
  constructor(@Inject(DB) private readonly db: Database, @Inject(DB_READ) private readonly read: Database) {}

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
        coverMediaId: listings.coverMediaId, status: listings.status,
      }).from(listings).where(inArray(listings.id, ids));
      const byId = new Map(rows.map((r) => [r.id, r]));
      return { items: saved.map((s) => byId.get(s.itemId)).filter(Boolean) };
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
