import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql, lt, or } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { requirements, requirementMatches, listings, users } from "../db/schema";
import { QueueService, QUEUES } from "../queue/queue.module";
import { CacheService } from "../redis/redis.module";
import { newId, encodeCursor, decodeCursor } from "../common/ids";
import { matchScore, MATCH_THRESHOLD } from "./matching";

@Injectable()
export class RequirementsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly queue: QueueService,
    private readonly cache: CacheService,
  ) {}

  async create(userId: string, input: Partial<typeof requirements.$inferInsert>) {
    const id = newId();
    const [row] = await this.db.insert(requirements).values({ ...input, id, userId } as typeof requirements.$inferInsert).returning();
    // Matching runs in the background, so posting a requirement is instant.
    await this.queue.add(QUEUES.ai, "match:requirement", { requirementId: id }, `match-${id}`);
    return row;
  }

  /** The public requirements board, newest first. */
  async list(q: { city?: string; purpose?: "sale" | "rent"; bhk?: number; cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 50);
    const cur = decodeCursor(q.cursor);
    const where = [eq(requirements.status, "active"), eq(users.status, "active")];
    if (q.city) where.push(eq(requirements.city, q.city));
    if (q.purpose) where.push(eq(requirements.purpose, q.purpose));
    if (q.bhk) where.push(eq(requirements.bhk, q.bhk));
    if (cur) where.push(or(lt(requirements.createdAt, new Date(cur.t)), and(eq(requirements.createdAt, new Date(cur.t)), lt(requirements.id, cur.id))!)!);

    const rows = await this.read.select({
      id: requirements.id, purpose: requirements.purpose, kind: requirements.kind, bhk: requirements.bhk,
      city: requirements.city, localities: requirements.localities, minPrice: requirements.minPrice,
      maxPrice: requirements.maxPrice, timeline: requirements.timeline, needsLoan: requirements.needsLoan,
      matchCount: requirements.matchCount, createdAt: requirements.createdAt,
      userId: users.id, userName: users.name, userType: users.type, userHeadline: users.headline, userAvatar: users.avatarMediaId,
    }).from(requirements).innerJoin(users, eq(users.id, requirements.userId))
      .where(and(...where))
      .orderBy(desc(requirements.createdAt), desc(requirements.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null };
  }

  async mine(userId: string) {
    const rows = await this.read.select().from(requirements)
      .where(eq(requirements.userId, userId)).orderBy(desc(requirements.createdAt)).limit(50);
    return { items: rows };
  }

  /** Best matching listings, precomputed in the background and cached. */
  async matches(requirementId: string, limit = 10) {
    return this.cache.wrap(`matches:${requirementId}`, 120, async () => {
      const rows = await this.read.select({
        score: requirementMatches.score,
        id: listings.id, title: listings.title, priceInr: listings.priceInr, purpose: listings.purpose,
        bhk: listings.bhk, areaSqft: listings.areaSqft, city: listings.city, locality: listings.locality,
        coverMediaId: listings.coverMediaId, ownerId: listings.ownerId,
      }).from(requirementMatches)
        .innerJoin(listings, eq(listings.id, requirementMatches.listingId))
        .where(and(eq(requirementMatches.requirementId, requirementId), eq(listings.status, "active"), eq(listings.hidden, false)))
        .orderBy(desc(requirementMatches.score)).limit(Math.min(limit, 30));
      return { items: rows };
    });
  }

  /**
   * Recomputes matches for one requirement. Postgres narrows the field with an index
   * (city, purpose, price band, bedroom range); the scorer then ranks that small set.
   */
  async recompute(requirementId: string) {
    const [req] = await this.read.select().from(requirements).where(eq(requirements.id, requirementId)).limit(1);
    if (!req) return { matched: 0 };

    const where = [eq(listings.status, "active"), eq(listings.hidden, false), eq(listings.city, req.city), eq(listings.purpose, req.purpose)];
    if (req.maxPrice) where.push(lte(listings.priceInr, Math.round(req.maxPrice * 1.15)));
    if (req.minPrice) where.push(gte(listings.priceInr, Math.round(req.minPrice * 0.7)));
    if (req.bhk) where.push(sql`${listings.bhk} between ${req.bhk - 1} and ${req.bhk + 1}`);

    const candidates = await this.read.select({
      id: listings.id, city: listings.city, locality: listings.locality, purpose: listings.purpose,
      kind: listings.kind, bhk: listings.bhk, priceInr: listings.priceInr, areaSqft: listings.areaSqft, possession: listings.possession,
    }).from(listings).where(and(...where)).orderBy(desc(listings.publishedAt)).limit(500);

    const scored = candidates
      .map((l) => ({ listingId: l.id, score: matchScore(l as never, req as never) }))
      .filter((m) => m.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    await this.db.transaction(async (tx) => {
      await tx.delete(requirementMatches).where(eq(requirementMatches.requirementId, requirementId));
      if (scored.length) {
        await tx.insert(requirementMatches).values(scored.map((m) => ({ requirementId, listingId: m.listingId, score: m.score })));
      }
      await tx.update(requirements).set({ matchCount: scored.length, updatedAt: new Date() }).where(eq(requirements.id, requirementId));
    });
    await this.cache.invalidate(`matches:${requirementId}`);
    return { matched: scored.length };
  }

  /** When a listing goes live, buyers waiting for exactly that are matched to it. */
  async matchNewListing(listingId: string) {
    const [l] = await this.read.select().from(listings).where(eq(listings.id, listingId)).limit(1);
    if (!l || l.status !== "active") return { matched: 0 };

    const candidates = await this.read.select().from(requirements)
      .where(and(eq(requirements.status, "active"), eq(requirements.city, l.city), eq(requirements.purpose, l.purpose)))
      .limit(1000);

    const hits = candidates
      .map((r) => ({ requirementId: r.id, score: matchScore(l as never, r as never) }))
      .filter((m) => m.score >= MATCH_THRESHOLD);

    if (hits.length) {
      await this.db.insert(requirementMatches)
        .values(hits.map((h) => ({ requirementId: h.requirementId, listingId, score: h.score })))
        .onConflictDoNothing();
      for (const h of hits) await this.cache.invalidate(`matches:${h.requirementId}`);
    }
    return { matched: hits.length };
  }

  async close(userId: string, id: string) {
    const [row] = await this.db.update(requirements).set({ status: "closed", updatedAt: new Date() })
      .where(and(eq(requirements.id, id), eq(requirements.userId, userId))).returning();
    if (!row) throw new NotFoundException("That requirement could not be found.");
    return row;
  }
}
