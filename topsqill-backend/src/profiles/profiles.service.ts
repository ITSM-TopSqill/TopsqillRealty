import { Injectable, Inject, NotFoundException, BadRequestException } from "@nestjs/common";
import { normaliseEmail } from "../auth/email";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { users, connections, media, profileViews, listings } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { MediaService } from "../media/media.service";
import { NotificationsService } from "../notifications/notifications.service";
import { assertNotBlocked, blockBetween } from "../account/blocks";

/** How complete a profile is, 0 to 100, and the next three things to add. */
export function profileStrength(u: Pick<typeof users.$inferSelect, "type" | "avatarMediaId" | "coverMediaId" | "headline" | "about" | "city" | "localities" | "specialties" | "kycVerified" | "reraVerified" | "listingCount">) {
  const pro = u.type === "dealer" || u.type === "builder";
  const checks: [boolean, number, string][] = [
    [!!u.avatarMediaId, 15, "Add a profile photo"],
    [!!u.headline, 10, "Write a headline"],
    [!!u.about && u.about.length >= 60, 10, "Write a short About"],
    [!!u.city, 5, "Add your city"],
    [(u.localities ?? []).length > 0, 10, "Add the areas you serve"],
    [(u.specialties ?? []).length > 0, 10, "Add your specialties"],
    [!!u.coverMediaId, 5, "Add a cover photo"],
    [u.kycVerified, 15, "Get KYC verified"],
    [!pro || u.reraVerified, 10, "Verify your RERA number"],
    [!pro || u.listingCount > 0, 10, "Add your first listing"],
  ];
  const total = checks.reduce((n, c) => n + c[1], 0);
  const score = Math.round((checks.filter((c) => c[0]).reduce((n, c) => n + c[1], 0) / total) * 100);
  return { score, next: checks.filter((c) => !c[0]).map((c) => c[2]).slice(0, 3) };
}

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
        specialties: u.specialties ?? [], interests: u.interests ?? [],
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
    // Someone who blocked me is simply not there for me; someone I blocked shows, so I can unblock.
    let blocked = false;
    if (viewerId && viewerId !== id) {
      const b = await blockBetween(this.read, viewerId, id);
      if (b.theyBlocked && !b.iBlocked) throw new NotFoundException("That profile is not available.");
      blocked = b.iBlocked;
    }
    let relation: "self" | "connected" | "pending" | "incoming" | "none" = "none";
    if (viewerId === id) relation = "self";
    else if (viewerId) relation = await this.relationOf(viewerId, id);
    let contact: { phone?: string; email?: string } | null = null;
    if (relation === "self" || relation === "connected") {
      const [u] = await this.read.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
      contact = { phone: u?.phone ?? undefined, email: u?.email ?? undefined };
    }
    return { ...profile, relation, contact, blocked };
  }

  async updateMe(userId: string, patch: Partial<typeof users.$inferInsert>) {
    const allowed = ["name", "type", "city", "localities", "specialties", "interests", "headline", "about", "agency", "yearsExperience", "reraNumber", "avatarMediaId", "coverMediaId", "email"] as const;
    const data: Record<string, unknown> = {};
    // `undefined` means "not sent". The validated DTO is a class instance, and
    // with ES2022+ class fields every declared property exists on it, so an
    // `in` check alone would treat untouched fields (email, reraNumber) as edits.
    for (const k of allowed) {
      const v = (patch as Record<string, unknown>)[k];
      if (v !== undefined) data[k] = v;
    }
    // Short tag lists: trimmed, unique, at most 12 of 40 characters each.
    for (const k of ["localities", "specialties", "interests"] as const) {
      if (Array.isArray(data[k])) data[k] = [...new Set((data[k] as unknown[]).map((x) => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
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

  /** Counts a signed-in member's visit to someone else's profile (once a day per viewer). */
  async recordView(viewerId: string, profileId: string) {
    if (!viewerId || viewerId === profileId) return { ok: true };
    await this.db.insert(profileViews).values({ profileId, viewerId }).onConflictDoNothing();
    return { ok: true };
  }

  /**
   * My profile card: how complete my profile is (with what to add next), who
   * viewed it in the last 30 days, and how often my listings were viewed.
   */
  async myStats(userId: string) {
    const [u] = await this.read.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new NotFoundException("That profile is not available.");
    const strength = profileStrength(u);
    const since = sql`current_date - 30`;
    const [[views], recent, [lv]] = await Promise.all([
      this.read.select({ n: sql<number>`count(distinct ${profileViews.viewerId})::int` }).from(profileViews)
        .where(and(eq(profileViews.profileId, userId), sql`${profileViews.day} >= ${since}`)),
      this.read.select({ id: users.id, name: users.name, type: users.type, headline: users.headline, avatarMediaId: users.avatarMediaId, day: profileViews.day })
        .from(profileViews).innerJoin(users, eq(users.id, profileViews.viewerId))
        .where(eq(profileViews.profileId, userId)).orderBy(desc(profileViews.day)).limit(5),
      this.read.select({ n: sql<number>`coalesce(sum(${listings.viewCount}), 0)::int` }).from(listings).where(eq(listings.ownerId, userId)),
    ]);
    return {
      strength,
      viewers30d: views?.n ?? 0,
      recentViewers: recent,
      listingViews: lv?.n ?? 0,
    };
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
    await assertNotBlocked(this.db, userId, peerId, "connect with this member");

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

  /** Photos for a page of people, in one query. */
  private async withAvatars<T extends { avatarMediaId?: string | null }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.avatarMediaId).filter(Boolean) as string[])];
    const pics = ids.length ? await this.read.select().from(media).where(inArray(media.id, ids)) : [];
    const byId = new Map(pics.map((m) => [m.id, this.mediaSvc.publicView(m)]));
    return rows.map((r) => ({ ...r, avatar: r.avatarMediaId ? byId.get(r.avatarMediaId) ?? null : null }));
  }

  /**
   * "accepted": my connections. "pending": invitations waiting for my answer.
   * "sent": invitations I sent that are not answered yet. Each request is
   * stored on both sides, so the direction comes from who requested it;
   * without that, invitations I sent showed up as if I had to accept them.
   * Connections can be searched (name, headline, agency, city), narrowed to one
   * kind of member, sorted, and paged; each person comes with mutual connections.
   */
  async listConnections(userId: string, status: "accepted" | "pending" | "sent" = "accepted", limit = 30,
    o: { q?: string; type?: string; sort?: "recent" | "name"; offset?: number } = {}) {
    const where = [eq(connections.userId, userId), eq(users.status, "active")];
    if (status === "accepted") where.push(eq(connections.status, "accepted"));
    else {
      where.push(eq(connections.status, "pending"));
      where.push(status === "sent" ? eq(connections.requestedBy, userId) : sql`${connections.requestedBy} <> ${userId}`);
    }
    const term = o.q?.trim().slice(0, 60);
    if (term) {
      const like = `%${term.replace(/[%_\\]/g, "")}%`;
      where.push(sql`(${users.name} ilike ${like} or ${users.headline} ilike ${like} or ${users.agency} ilike ${like} or ${users.city} ilike ${like})`);
    }
    if (o.type && ["buyer", "seller", "dealer", "builder"].includes(o.type)) where.push(eq(users.type, o.type as never));
    const offset = Math.max(o.offset ?? 0, 0);
    const [rows, [{ n }]] = await Promise.all([
      this.read.select({
        id: users.id, name: users.name, type: users.type, headline: users.headline, agency: users.agency,
        city: users.city, avatarMediaId: users.avatarMediaId, kycVerified: users.kycVerified, reraVerified: users.reraVerified,
        since: connections.createdAt,
        mutual: sql<number>`(select count(*)::int from connections a join connections b on b.peer_id = a.peer_id
                              where a.user_id = ${userId} and a.status = 'accepted' and b.user_id = ${users.id} and b.status = 'accepted')`,
      }).from(connections)
        .innerJoin(users, eq(users.id, connections.peerId))
        .where(and(...where))
        .orderBy(...(o.sort === "name" ? [sql`lower(${users.name})`] : [desc(connections.createdAt)]))
        .limit(Math.min(limit, 100)).offset(offset),
      this.read.select({ n: sql<number>`count(*)::int` }).from(connections).innerJoin(users, eq(users.id, connections.peerId)).where(and(...where)),
    ]);
    return { items: await this.withAvatars(rows), total: n, nextOffset: offset + rows.length < n ? offset + rows.length : null };
  }

  /** Counts for the network page's menu. */
  async networkSummary(userId: string) {
    const [r] = await this.read.select({
      connections: sql<number>`count(*) filter (where ${connections.status} = 'accepted')::int`,
      pending: sql<number>`count(*) filter (where ${connections.status} = 'pending' and ${connections.requestedBy} <> ${userId})::int`,
      sent: sql<number>`count(*) filter (where ${connections.status} = 'pending' and ${connections.requestedBy} = ${userId})::int`,
      dealers: sql<number>`count(*) filter (where ${connections.status} = 'accepted' and ${users.type} = 'dealer')::int`,
      builders: sql<number>`count(*) filter (where ${connections.status} = 'accepted' and ${users.type} = 'builder')::int`,
      buyers: sql<number>`count(*) filter (where ${connections.status} = 'accepted' and ${users.type} = 'buyer')::int`,
      sellers: sql<number>`count(*) filter (where ${connections.status} = 'accepted' and ${users.type} = 'seller')::int`,
    }).from(connections).innerJoin(users, eq(users.id, connections.peerId))
      .where(and(eq(connections.userId, userId), eq(users.status, "active")));
    return r;
  }

  /** Takes back an invitation I sent that hasn't been answered. */
  async withdraw(userId: string, peerId: string) {
    const gone = await this.db.delete(connections).where(and(eq(connections.status, "pending"), eq(connections.requestedBy, userId),
      sql`((${connections.userId} = ${userId} and ${connections.peerId} = ${peerId}) or (${connections.userId} = ${peerId} and ${connections.peerId} = ${userId}))`))
      .returning({ userId: connections.userId });
    if (!gone.length) throw new NotFoundException("There is no invitation to take back.");
    // Their "wants to connect" alert no longer applies.
    await this.notifs.markReadFor(peerId, "profile", userId).catch(() => null);
    return { ok: true, status: "none" };
  }

  /** Removes a connection on both sides. They aren't told. */
  async removeConnection(userId: string, peerId: string) {
    const removed = await this.db.transaction(async (tx) => {
      const rows = await tx.delete(connections).where(and(eq(connections.status, "accepted"),
        sql`((${connections.userId} = ${userId} and ${connections.peerId} = ${peerId}) or (${connections.userId} = ${peerId} and ${connections.peerId} = ${userId}))`))
        .returning({ userId: connections.userId });
      if (rows.length) await tx.update(users).set({ connectionCount: sql`greatest(${users.connectionCount} - 1, 0)` }).where(inArray(users.id, [userId, peerId]));
      return rows.length;
    });
    if (!removed) throw new NotFoundException("You aren't connected with this member.");
    await this.cache.redis.del(`profile:${userId}`, `profile:${peerId}`, `audience:${userId}`, `audience:${peerId}`).catch(() => 0);
    return { ok: true, status: "none" };
  }

  /**
   * People you may know: active members I have no connection or request with,
   * ranked by shared connections, then same city and type of work, then how
   * established they are. Each comes with the reason it's suggested.
   */
  async suggestions(userId: string, limit = 12, type?: string, offset = 0) {
    const [me] = await this.read.select({ city: users.city, type: users.type }).from(users).where(eq(users.id, userId)).limit(1);
    const kind = type && ["buyer", "seller", "dealer", "builder"].includes(type) ? type : null;
    const res = await this.read.execute(sql`
      with mine as (select peer_id from connections where user_id = ${userId} and status = 'accepted')
      select u.id, u.name, u.type, u.headline, u.city, u.agency, u.avatar_media_id as "avatarMediaId",
             u.kyc_verified as "kycVerified", u.rera_verified as "reraVerified", u.connection_count as "connectionCount",
             (select count(*)::int from connections c where c.user_id = u.id and c.status = 'accepted' and c.peer_id in (select peer_id from mine)) as mutual
      from users u
      where u.status = 'active' and u.id <> ${userId}
        and (${kind}::text is null or u.type::text = ${kind})
        and not exists (select 1 from connections c where c.user_id = ${userId} and c.peer_id = u.id)
        and not exists (select 1 from user_blocks ub where (ub.blocker_id = ${userId} and ub.blocked_id = u.id) or (ub.blocker_id = u.id and ub.blocked_id = ${userId}))
      order by mutual desc, (u.city is not distinct from ${me?.city ?? null}) desc, u.connection_count desc, u.created_at desc
      limit ${Math.min(limit, 48) + 1} offset ${Math.max(offset, 0)}`);
    const all = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Record<string, any>[];
    const rows = all.slice(0, Math.min(limit, 48));
    const label: Record<string, string> = { dealer: "dealer", builder: "builder", buyer: "buyer", seller: "owner" };
    const items = rows.map((r): Record<string, any> & { avatarMediaId?: string | null } => ({
      ...r,
      reason: r.mutual ? `${r.mutual} mutual connection${r.mutual === 1 ? "" : "s"}`
        : me?.city && r.city === me.city ? `${(label[r.type] ?? "member").replace(/^./, (c: string) => c.toUpperCase())} in ${r.city}`
        : r.connectionCount > 20 ? `Well connected · ${r.connectionCount} connections` : r.city ? `Based in ${r.city}` : "New on Topsqill",
    }));
    return { items: await this.withAvatars(items), nextOffset: all.length > rows.length ? Math.max(offset, 0) + rows.length : null };
  }
}
