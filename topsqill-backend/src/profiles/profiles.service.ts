import { Injectable, Inject, NotFoundException, BadRequestException } from "@nestjs/common";
import { normaliseEmail } from "../auth/email";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { users, connections, media } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { MediaService } from "../media/media.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly cache: CacheService,
    private readonly mediaSvc: MediaService,
    private readonly notifs: NotificationsService,
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
    // "pending" is a request I sent; "incoming" is one waiting for my answer.
    // An invitation I ignored reads as "none", so I can still connect later.
    let relation: "self" | "connected" | "pending" | "incoming" | "none" = "none";
    if (viewerId === id) relation = "self";
    else if (viewerId) relation = await this.relationOf(viewerId, id);
    let contact: { phone?: string; email?: string } | null = null;
    if (relation === "self" || relation === "connected") {
      const [u] = await this.read.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
      contact = { phone: u?.phone ?? undefined, email: u?.email ?? undefined };
    }
    return { ...profile, relation, contact };
  }

  async updateMe(userId: string, patch: Partial<typeof users.$inferInsert>) {
    const allowed = ["name", "type", "city", "localities", "headline", "about", "agency", "yearsExperience", "reraNumber", "avatarMediaId", "coverMediaId", "email"] as const;
    const data: Record<string, unknown> = {};
    // `undefined` means "not sent". The validated DTO is a class instance, and
    // with ES2022+ class fields every declared property exists on it, so an
    // `in` check alone would treat untouched fields (email, reraNumber) as edits.
    for (const k of allowed) {
      const v = (patch as Record<string, unknown>)[k];
      if (v !== undefined) data[k] = v;
    }
    if (!Object.keys(data).length) return this.getProfile(userId, userId);
    data.updatedAt = new Date();
    if ("reraNumber" in data) data.reraVerified = false;  // re-verify after any change
    if ("email" in data) await this.applyEmailChange(userId, data);
    await this.db.update(users).set(data as any).where(eq(users.id, userId));
    await this.cache.invalidate(`profile:${userId}`);
    return this.getProfile(userId, userId);
  }

  /**
   * A typed-in address is unverified until proven with a code, so it can never
   * be used to sign in, and so nobody can claim someone else's address.
   * Members who joined by email sign in with it, so they cannot change it here:
   * that would lock them out of their own account.
   */
  private async applyEmailChange(userId: string, data: Record<string, unknown>) {
    const raw = data.email as string | null | undefined;
    const next = raw == null || String(raw).trim() === "" ? null : normaliseEmail(raw);
    if (raw && !next) throw new BadRequestException("Enter a valid email address.");
    const [me] = await this.db.select({ email: users.email, emailVerified: users.emailVerified, phone: users.phone })
      .from(users).where(eq(users.id, userId)).limit(1);
    if ((me?.email ?? null) === next) { delete data.email; return; }
    if (me && !me.phone && me.emailVerified) {
      throw new BadRequestException("You sign in with this email, so it can’t be changed here yet.");
    }
    data.email = next;
    data.emailVerified = false;
  }

  private async relationOf(viewerId: string, peerId: string) {
    const [c] = await this.db.select({ status: connections.status, requestedBy: connections.requestedBy }).from(connections)
      .where(and(eq(connections.userId, viewerId), eq(connections.peerId, peerId))).limit(1);
    if (!c) return "none" as const;
    if (c.status === "accepted") return "connected" as const;
    if (c.status === "pending") return c.requestedBy === viewerId ? "pending" as const : "incoming" as const;
    // Ignored: the person who sent it still sees "pending", the one who ignored it can connect again.
    return c.requestedBy === viewerId ? "pending" as const : "none" as const;
  }

  /**
   * Connect. If they already invited me, this accepts their invitation rather
   * than leaving two requests crossing in the post.
   */
  async connect(userId: string, peerId: string) {
    if (userId === peerId) throw new BadRequestException("You can’t connect with yourself.");
    const [peer] = await this.read.select({ status: users.status }).from(users).where(eq(users.id, peerId)).limit(1);
    if (!peer || peer.status !== "active") throw new NotFoundException("That member is not available.");

    const relation = await this.relationOf(userId, peerId);
    if (relation === "connected") return { ok: true, status: "connected" };
    if (relation === "pending") return { ok: true, status: "pending" };
    if (relation === "incoming") return this.respond(userId, peerId, true);

    await this.db.transaction(async (tx) => {
      // A request I once ignored is replaced by my own.
      await tx.delete(connections).where(and(eq(connections.status, "ignored"),
        sql`(${connections.userId} = ${userId} and ${connections.peerId} = ${peerId}) or (${connections.userId} = ${peerId} and ${connections.peerId} = ${userId})`));
      await tx.insert(connections).values([
        { userId, peerId, status: "pending", requestedBy: userId },
        { userId: peerId, peerId: userId, status: "pending", requestedBy: userId },
      ]).onConflictDoNothing();
    });
    const [me] = await this.read.select({ name: users.name, headline: users.headline }).from(users).where(eq(users.id, userId)).limit(1);
    await this.notifs.create({
      userId: peerId, kind: "connection", title: `${me?.name ?? "A member"} wants to connect`,
      body: me?.headline ?? null, actorId: userId, targetType: "profile", targetId: userId,
    });
    return { ok: true, status: "pending" };
  }

  /**
   * Accept or ignore a request. Only the person who received a still-pending
   * request may answer it, and only once: the guarded update below is what
   * stops someone accepting their own request, or inflating connection counts
   * by accepting repeatedly or where no request exists.
   */
  async respond(userId: string, peerId: string, accept: boolean) {
    const status = accept ? "accepted" : "ignored";
    await this.db.transaction(async (tx) => {
      const pendingFromPeer = and(
        eq(connections.status, "pending"),
        eq(connections.requestedBy, peerId),
      );
      const answered = await tx.update(connections).set({ status })
        .where(and(eq(connections.userId, userId), eq(connections.peerId, peerId), pendingFromPeer))
        .returning({ userId: connections.userId });
      if (!answered.length) throw new NotFoundException("There is no pending request from this member.");
      await tx.update(connections).set({ status })
        .where(and(eq(connections.userId, peerId), eq(connections.peerId, userId), pendingFromPeer));
      if (accept) {
        await tx.update(users).set({ connectionCount: sql`${users.connectionCount} + 1` }).where(inArray(users.id, [userId, peerId]));
      }
    });
    // Both feeds now include each other's posts, and both profile cards change.
    await this.cache.redis.del(`profile:${userId}`, `profile:${peerId}`, `audience:${userId}`, `audience:${peerId}`).catch(() => 0);
    // The invitation alert is answered either way.
    await this.notifs.markReadFor(userId, "profile", peerId);
    if (accept) {
      const name = await this.notifs.nameOf(userId);
      await this.notifs.create({
        userId: peerId, kind: "connection", title: `${name} accepted your invitation`,
        body: "You can now message each other and see each other’s posts.", actorId: userId, targetType: "profile", targetId: userId,
      });
    }
    return { ok: true, status: accept ? "connected" : "ignored" };
  }

  /**
   * "accepted": my connections. "pending": invitations waiting for my answer.
   * "sent": invitations I sent that are not answered yet. Each request is
   * stored on both sides, so the direction comes from who requested it;
   * without that, invitations I sent showed up as if I had to accept them.
   */
  async listConnections(userId: string, status: "accepted" | "pending" | "sent" = "accepted", limit = 30) {
    const where = status === "accepted"
      ? and(eq(connections.userId, userId), eq(connections.status, "accepted"))
      : and(eq(connections.userId, userId), eq(connections.status, "pending"),
          status === "sent" ? eq(connections.requestedBy, userId) : sql`${connections.requestedBy} <> ${userId}`);
    const rows = await this.read.select({
      id: users.id, name: users.name, type: users.type, headline: users.headline,
      city: users.city, avatarMediaId: users.avatarMediaId, kycVerified: users.kycVerified,
    }).from(connections)
      .innerJoin(users, eq(users.id, connections.peerId))
      .where(and(where, eq(users.status, "active")))
      .orderBy(desc(connections.createdAt))
      .limit(Math.min(limit, 100));
    return { items: rows };
  }

  /**
   * People you may know: active members I have no connection or request with,
   * ranked by shared connections, then same city and type of work, then how
   * established they are.
   */
  async suggestions(userId: string, limit = 12) {
    const [me] = await this.read.select({ city: users.city }).from(users).where(eq(users.id, userId)).limit(1);
    const res = await this.read.execute(sql`
      with mine as (select peer_id from connections where user_id = ${userId} and status = 'accepted')
      select u.id, u.name, u.type, u.headline, u.city, u.avatar_media_id as "avatarMediaId",
             u.kyc_verified as "kycVerified", u.rera_verified as "reraVerified",
             (select count(*)::int from connections c where c.user_id = u.id and c.status = 'accepted' and c.peer_id in (select peer_id from mine)) as mutual
      from users u
      where u.status = 'active' and u.id <> ${userId}
        and not exists (select 1 from connections c where c.user_id = ${userId} and c.peer_id = u.id)
      order by mutual desc, (u.city is not distinct from ${me?.city ?? null}) desc, u.connection_count desc, u.created_at desc
      limit ${Math.min(limit, 50)}`);
    const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Record<string, unknown>[];
    return { items: rows };
  }
}
