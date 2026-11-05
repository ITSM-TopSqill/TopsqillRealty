import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { users, connections, media } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { MediaService } from "../media/media.service";

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly cache: CacheService,
    private readonly mediaSvc: MediaService,
  ) {}

  /** Profile card data, cached for 2 minutes: it appears on nearly every screen. */
  async getProfile(id: string, viewerId?: string) {
    const profile = await this.cache.wrap(`profile:${id}`, 120, async () => {
      const [u] = await this.read.select().from(users).where(eq(users.id, id)).limit(1);
      if (!u || u.status === "removed") throw new NotFoundException("That profile is not available.");
      const mediaIds = [u.avatarMediaId, u.coverMediaId].filter(Boolean) as string[];
      const pics = mediaIds.length ? await this.read.select().from(media).where(inArray(media.id, mediaIds)) : [];
      const byId = new Map(pics.map((m) => [m.id, this.mediaSvc.publicView(m)]));
      return {
        id: u.id, name: u.name, type: u.type, status: u.status, isAdmin: u.isAdmin, headline: u.headline, about: u.about,
        city: u.city, localities: u.localities, agency: u.agency, yearsExperience: u.yearsExperience,
        kycVerified: u.kycVerified, reraVerified: u.reraVerified, reraNumber: u.reraVerified ? u.reraNumber : null,
        connectionCount: u.connectionCount, followerCount: u.followerCount, listingCount: u.listingCount,
        avatar: u.avatarMediaId ? byId.get(u.avatarMediaId) ?? null : null,
        cover: u.coverMediaId ? byId.get(u.coverMediaId) ?? null : null,
        createdAt: u.createdAt,
      };
    });

    // Contact details are only shown to accepted connections (and to yourself).
    let relation: "self" | "connected" | "pending" | "none" = "none";
    if (viewerId === id) relation = "self";
    else if (viewerId) {
      const [c] = await this.read.select({ status: connections.status }).from(connections)
        .where(and(eq(connections.userId, viewerId), eq(connections.peerId, id))).limit(1);
      relation = c ? (c.status === "accepted" ? "connected" : "pending") : "none";
    }
    let contact: { phone?: string; email?: string } | null = null;
    if (relation === "self" || relation === "connected") {
      const [u] = await this.read.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
      contact = { phone: u?.phone, email: u?.email ?? undefined };
    }
    return { ...profile, relation, contact };
  }

  async updateMe(userId: string, patch: Partial<typeof users.$inferInsert>) {
    const allowed = ["name", "type", "city", "localities", "headline", "about", "agency", "yearsExperience", "reraNumber", "avatarMediaId", "coverMediaId", "email"] as const;
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (k in patch) data[k] = (patch as Record<string, unknown>)[k];
    if (!Object.keys(data).length) return this.getProfile(userId, userId);
    data.updatedAt = new Date();
    if ("reraNumber" in data) data.reraVerified = false;  // re-verify after any change
    await this.db.update(users).set(data as any).where(eq(users.id, userId));
    await this.cache.invalidate(`profile:${userId}`);
    return this.getProfile(userId, userId);
  }

  /** Connection request. Both directions are written in one transaction. */
  async connect(userId: string, peerId: string) {
    if (userId === peerId) return { ok: false, message: "You can’t connect with yourself." };
    await this.db.transaction(async (tx) => {
      await tx.insert(connections).values([
        { userId, peerId, status: "pending", requestedBy: userId },
        { userId: peerId, peerId: userId, status: "pending", requestedBy: userId },
      ]).onConflictDoNothing();
    });
    return { ok: true, status: "pending" };
  }

  async respond(userId: string, peerId: string, accept: boolean) {
    const status = accept ? "accepted" : "ignored";
    await this.db.transaction(async (tx) => {
      await tx.update(connections).set({ status })
        .where(and(eq(connections.userId, userId), eq(connections.peerId, peerId)));
      await tx.update(connections).set({ status })
        .where(and(eq(connections.userId, peerId), eq(connections.peerId, userId)));
      if (accept) {
        await tx.update(users).set({ connectionCount: sql`${users.connectionCount} + 1` }).where(inArray(users.id, [userId, peerId]));
      }
    });
    await Promise.all([this.cache.invalidate(`profile:${userId}`), this.cache.invalidate(`profile:${peerId}`)]);
    return { ok: true, status };
  }

  async listConnections(userId: string, status: "accepted" | "pending" = "accepted", limit = 30) {
    const rows = await this.read.select({
      id: users.id, name: users.name, type: users.type, headline: users.headline,
      city: users.city, avatarMediaId: users.avatarMediaId, kycVerified: users.kycVerified,
    }).from(connections)
      .innerJoin(users, eq(users.id, connections.peerId))
      .where(and(eq(connections.userId, userId), eq(connections.status, status), eq(users.status, "active")))
      .orderBy(desc(connections.createdAt))
      .limit(Math.min(limit, 100));
    return { items: rows };
  }
}
