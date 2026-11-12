import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { posts, postLikes, postComments, connections, follows, users, media, listings, jobs, projects, requirements } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { MediaService } from "../media/media.service";
import { NotificationsService } from "../notifications/notifications.service";
import { newId, encodeCursor, decodeCursor } from "../common/ids";

/**
 * The wall reads straight from Postgres (see home()), so a post, listing,
 * requirement or job shows the moment it's saved.
 */

export type FeedFilter = "following" | "listings" | "requirements" | "projects" | "jobs" | "insights";
const FILTER_KIND = { listings: "listing", requirements: "requirement", projects: "project", jobs: "job", insights: "insight" } as const;

@Injectable()
export class FeedService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly cache: CacheService,
    private readonly mediaSvc: MediaService,
    private readonly notifs: NotificationsService,
  ) {}

  async createPost(userId: string, input: { kind?: string; body: string; refId?: string; mediaIds?: string[] }) {
    const id = newId();
    const [row] = await this.db.insert(posts).values({
      id, authorId: userId, kind: (input.kind as any) ?? "update",
      body: input.body, refId: input.refId ?? null, mediaIds: input.mediaIds ?? [],
    }).returning();
    return row;
  }

  /**
   * Home feed, newest first, from Postgres: posts from my network and me, plus
   * new listings, requirements, projects and jobs from members in my city (so
   * the wall always has what's happening locally, even with few connections).
   *
   * It used to read a list in Redis that a background job filled after each
   * post, so a new post (even my own) appeared only once that job had run.
   * The first page reads the primary database, so what I just posted is
   * always there; later pages use the replica.
   */
  async home(userId: string, cursor?: string, limit = 20, filter?: FeedFilter) {
    limit = Math.min(Math.max(limit, 1), 50);
    let after = cursor?.startsWith("d:") ? cursor.slice(2) : undefined;
    // Older apps may still hold a cursor from the Redis list: carry on after that post.
    if (cursor?.startsWith("c:")) {
      const [p] = await this.read.select({ createdAt: posts.createdAt }).from(posts).where(eq(posts.id, cursor.slice(2))).limit(1);
      after = p ? encodeCursor(p.createdAt, cursor.slice(2)) : undefined;
    }
    if (filter) return this.filtered(userId, filter, after, limit);
    return this.homeFromDb(userId, after, limit);
  }

  /**
   * The feed narrowed to one kind of post. "following" is only people I'm
   * connected with or follow; the others (listings, requirements, projects,
   * insights) are posts of that kind from everyone, so there is always
   * something to read. Always from Postgres, with "d:" cursors.
   */
  private async filtered(userId: string, filter: FeedFilter, cursor: string | undefined, limit: number) {
    const cur = decodeCursor(cursor);
    const src = cursor ? this.read : this.db;
    const where = [eq(posts.hidden, false)];
    if (filter === "following") {
      const authorIds = await this.audienceOf(userId);
      if (!authorIds.length) return { items: [], nextCursor: null, source: "db" };
      where.push(inArray(posts.authorId, authorIds));
    } else {
      where.push(eq(posts.kind, FILTER_KIND[filter]));
    }
    if (cur) where.push(or(lt(posts.createdAt, new Date(cur.t)), and(eq(posts.createdAt, new Date(cur.t)), lt(posts.id, cur.id))!)!);
    const rows = await src.select().from(posts).where(and(...where)).orderBy(desc(posts.createdAt), desc(posts.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: await this.decorate(page, userId, 0, src),
      nextCursor: hasMore && page.length ? `d:${encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)}` : null,
      source: "db",
    };
  }

  /**
   * Reposts a post to my network, optionally with my own words on top. A
   * repost of a repost points at the original, so chains never nest.
   */
  async repost(userId: string, postId: string, comment?: string) {
    const [p] = await this.read.select({ id: posts.id, authorId: posts.authorId, body: posts.body, kind: posts.kind, repostOfId: posts.repostOfId })
      .from(posts).where(and(eq(posts.id, postId), eq(posts.hidden, false))).limit(1);
    if (!p) throw new NotFoundException("That post is not available.");
    const originalId = p.repostOfId ?? p.id;
    const [original] = originalId === p.id ? [p] : await this.read.select({ id: posts.id, authorId: posts.authorId, body: posts.body, kind: posts.kind, repostOfId: posts.repostOfId })
      .from(posts).where(and(eq(posts.id, originalId), eq(posts.hidden, false))).limit(1);
    if (!original) throw new NotFoundException("The original post is no longer available.");
    if (original.authorId === userId && !comment?.trim()) throw new BadRequestException("This is your own post. Add a few words to share it again.");

    const id = newId();
    const [row] = await this.db.insert(posts).values({
      id, authorId: userId, kind: original.kind, body: (comment ?? "").trim().slice(0, 3000), repostOfId: original.id, mediaIds: [],
    }).returning();
    await this.db.update(posts).set({ repostCount: sql`${posts.repostCount} + 1` }).where(eq(posts.id, original.id));
    if (original.authorId !== userId) {
      const name = await this.notifs.nameOf(userId);
      await this.notifs.create({ userId: original.authorId, kind: "post", title: `${name} reposted your post`, body: excerpt(original.body), actorId: userId, targetType: "post", targetId: original.id }).catch(() => null);
    }
    return row;
  }

  /**
   * Home page right column, for the member's city (or everywhere when no city
   * is set): the localities with the most new and most-viewed listings, open
   * jobs, and newly published projects. Cached for 10 minutes per city.
   */
  async sidebar(userId: string) {
    const [me] = await this.read.select({ city: users.city }).from(users).where(eq(users.id, userId)).limit(1);
    const city = me?.city ?? null;
    return this.cache.wrap(`sidebar:${city ?? "all"}`, 600, async () => {
      const inCity = <T extends { city: unknown }>(t: T) => (city ? sql`lower(${t.city}) = lower(${city})` : sql`true`);
      const [hot, openJobs, launches] = await Promise.all([
        this.read.select({
          locality: listings.locality, city: listings.city,
          count: sql<number>`count(*)::int`,
          avgRate: sql<number>`round(avg(case when ${listings.purpose} = 'sale' and ${listings.areaSqft} > 0 then ${listings.priceInr}::numeric / ${listings.areaSqft} end))::int`,
          heat: sql<number>`sum(${listings.viewCount} + ${listings.saveCount} * 3 + 5)::int`,
        }).from(listings)
          .where(and(eq(listings.status, "active"), eq(listings.hidden, false), inCity(listings), sql`${listings.createdAt} > now() - interval '60 days'`))
          .groupBy(listings.locality, listings.city).orderBy(sql`4 desc`).limit(5),
        this.read.select({ id: jobs.id, title: jobs.title, company: jobs.company, city: jobs.city, locality: jobs.locality, createdAt: jobs.createdAt })
          .from(jobs).where(and(eq(jobs.status, "open"), inCity(jobs))).orderBy(desc(jobs.createdAt)).limit(3),
        this.read.select({ id: projects.id, name: projects.name, builder: projects.builder, city: projects.city, locality: projects.locality, status: projects.status, configs: projects.configs })
          .from(projects).where(and(eq(projects.published, true), inCity(projects))).orderBy(desc(projects.createdAt)).limit(3),
      ]);
      return {
        city,
        hotLocalities: hot.map((h) => ({ locality: h.locality, city: h.city, listings: h.count, avgRatePerSqft: h.avgRate || null })),
        jobs: openJobs,
        launches: launches.map(({ configs, ...p }) => ({ ...p, fromPrice: configs.length ? Math.min(...configs.map((c) => c.price).filter((n) => n > 0)) || null : null, bhks: [...new Set(configs.map((c) => c.bhk))].sort() })),
      };
    });
  }

  private async homeFromDb(userId: string, cursor?: string, limit = 20) {
    const cur = decodeCursor(cursor);
    const src = cursor ? this.read : this.db;
    const [authorIds, [me]] = await Promise.all([
      this.audienceOf(userId),
      this.read.select({ city: users.city }).from(users).where(eq(users.id, userId)).limit(1),
    ]);
    const where = [eq(posts.hidden, false)];
    if (authorIds.length) {
      // New listings, requirements, projects and jobs from members in my city (or anywhere, if I haven't set one).
      const local = me?.city
        ? sql`${posts.authorId} in (select id from users where lower(city) = lower(${me.city}))`
        : sql`true`;
      where.push(or(
        inArray(posts.authorId, [...authorIds, userId]),
        and(inArray(posts.kind, ["listing", "requirement", "project", "job"]), local),
      )!);
    }
    if (cur) where.push(or(lt(posts.createdAt, new Date(cur.t)), and(eq(posts.createdAt, new Date(cur.t)), lt(posts.id, cur.id))!)!);

    const rows = await src.select().from(posts).where(and(...where))
      .orderBy(desc(posts.createdAt), desc(posts.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: await this.decorate(page, userId, 0, src),
      nextCursor: hasMore && page.length ? `d:${encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)}` : null,
      source: "db",
    };
  }

  private async audienceOf(userId: string) {
    // Short, so someone I just connected with or followed shows up within a minute.
    return this.cache.wrap(`audience:${userId}`, 60, async () => {
      const [conns, fols] = await Promise.all([
        this.read.select({ id: connections.peerId }).from(connections)
          .where(and(eq(connections.userId, userId), eq(connections.status, "accepted"))).limit(2000),
        this.read.select({ id: follows.targetId }).from(follows).where(eq(follows.followerId, userId)).limit(2000),
      ]);
      return [...new Set([...conns.map((c) => c.id), ...fols.map((f) => f.id)])];
    });
  }

  /** Authors, media and "did I like this" are each one query for the whole page. */
  private async decorate(rows: (typeof posts.$inferSelect)[], viewerId: string, depth = 0, src: Database = this.read): Promise<any[]> {
    if (!rows.length) return [];
    // What a listing, requirement or job post is about, shown as a card on the post.
    const refs = await this.refsFor(rows, src);
    // A post about a listing that's no longer up (unlisted, removed, in review) or a closed requirement is left out.
    rows = rows.filter((r) => !refs.missing.has(r.id));
    // Reposts carry the original post (one level, never nested).
    const originalIds = depth ? [] : [...new Set(rows.map((r) => r.repostOfId).filter(Boolean) as string[])];
    const originals = originalIds.length
      ? await this.decorate(await this.read.select().from(posts).where(and(inArray(posts.id, originalIds), eq(posts.hidden, false))), viewerId, 1)
      : [];
    const originalById = new Map(originals.map((o: { id: string }) => [o.id, o]));
    const authorIds = [...new Set(rows.map((r) => r.authorId))];
    const mediaIds = [...new Set(rows.flatMap((r) => r.mediaIds ?? []))];
    const [authors, pics, liked] = await Promise.all([
      this.read.select({ id: users.id, name: users.name, type: users.type, headline: users.headline, avatarMediaId: users.avatarMediaId, kycVerified: users.kycVerified })
        .from(users).where(inArray(users.id, authorIds)),
      mediaIds.length ? this.read.select().from(media).where(inArray(media.id, mediaIds)) : Promise.resolve([]),
      viewerId ? this.read.select({ postId: postLikes.postId }).from(postLikes)
        .where(and(eq(postLikes.userId, viewerId), inArray(postLikes.postId, rows.map((r) => r.id)))) : Promise.resolve([]),
    ]);
    const authorById = new Map(authors.map((a) => [a.id, a]));
    const mediaById = new Map(pics.map((m) => [m.id, this.mediaSvc.publicView(m)]));
    const likedSet = new Set(liked.map((l) => l.postId));
    return rows.map((r) => ({
      ...r,
      author: authorById.get(r.authorId) ?? null,
      media: (r.mediaIds ?? []).map((id) => mediaById.get(id)).filter(Boolean),
      likedByMe: likedSet.has(r.id),
      ...(r.repostOfId ? { repostOf: originalById.get(r.repostOfId) ?? null } : {}),
      ...(refs.byPost.has(r.id) ? { ref: refs.byPost.get(r.id) } : {}),
    }));
  }

  /** The listing, requirement or job behind each post (one query per kind for the whole page). */
  private async refsFor(rows: (typeof posts.$inferSelect)[], src: Database) {
    const ids = (kind: string) => [...new Set(rows.filter((r) => r.kind === kind && r.refId && !r.repostOfId).map((r) => r.refId!))];
    const [lIds, rIds, jIds] = [ids("listing"), ids("requirement"), ids("job")];
    const [ls, rs, js] = await Promise.all([
      lIds.length ? src.select({ id: listings.id, title: listings.title, purpose: listings.purpose, kind: listings.kind, bhk: listings.bhk, areaSqft: listings.areaSqft,
        priceInr: listings.priceInr, city: listings.city, locality: listings.locality, status: listings.status, hidden: listings.hidden, possession: listings.possession,
        coverMediaId: listings.coverMediaId, verified: listings.verified }).from(listings).where(inArray(listings.id, lIds)) : Promise.resolve([]),
      rIds.length ? src.select({ id: requirements.id, purpose: requirements.purpose, kind: requirements.kind, bhk: requirements.bhk, city: requirements.city,
        localities: requirements.localities, minPrice: requirements.minPrice, maxPrice: requirements.maxPrice, timeline: requirements.timeline, status: requirements.status,
        matchCount: requirements.matchCount }).from(requirements).where(inArray(requirements.id, rIds)) : Promise.resolve([]),
      jIds.length ? src.select({ id: jobs.id, title: jobs.title, company: jobs.company, city: jobs.city, locality: jobs.locality, status: jobs.status,
        employment: jobs.employment, workMode: jobs.workMode, salaryMin: jobs.salaryMin, salaryMax: jobs.salaryMax, expMin: jobs.expMin, expMax: jobs.expMax })
        .from(jobs).where(inArray(jobs.id, jIds)) : Promise.resolve([]),
    ]);
    const coverIds = ls.map((l) => l.coverMediaId).filter(Boolean) as string[];
    const covers = coverIds.length ? await src.select().from(media).where(inArray(media.id, coverIds)) : [];
    const coverById = new Map(covers.map((m) => [m.id, this.mediaSvc.publicView(m)]));
    const L = new Map(ls.map(({ hidden, coverMediaId, ...l }) => [l.id, { type: "listing" as const, ...l, hidden, cover: coverMediaId ? coverById.get(coverMediaId) ?? null : null }]));
    const R = new Map(rs.map((r) => [r.id, { type: "requirement" as const, ...r }]));
    const J = new Map(js.map((j) => [j.id, { type: "job" as const, ...j }]));
    const byPost = new Map<string, unknown>();
    const missing = new Set<string>();
    for (const r of rows) {
      if (!r.refId || r.repostOfId) continue;
      if (r.kind === "listing") {
        const l = L.get(r.refId);
        // A listing post made before this card existed may point at nothing: keep the post, without a card.
        if (l && (l.hidden || !["active", "sold"].includes(l.status))) missing.add(r.id);
        else if (l) { const { hidden: _h, ...card } = l; byPost.set(r.id, card); }
      } else if (r.kind === "requirement") {
        const q = R.get(r.refId);
        if (q && q.status === "closed") missing.add(r.id);
        else if (q) byPost.set(r.id, q);
      } else if (r.kind === "job") {
        const j = J.get(r.refId);
        if (j && j.status === "draft") missing.add(r.id);
        else if (j) byPost.set(r.id, j);
      }
    }
    return { byPost, missing };
  }

  /** One post, for its own page (shared links and alerts open it). */
  async getPost(postId: string, viewerId?: string) {
    const [row] = await this.read.select().from(posts).where(and(eq(posts.id, postId), eq(posts.hidden, false))).limit(1);
    if (!row) throw new NotFoundException("That post is not available.");
    const [item] = await this.decorate([row], viewerId ?? "");
    return item;
  }

  private async postOrFail(postId: string) {
    const [p] = await this.read.select({ id: posts.id, authorId: posts.authorId, body: posts.body })
      .from(posts).where(and(eq(posts.id, postId), eq(posts.hidden, false))).limit(1);
    if (!p) throw new NotFoundException("That post is not available.");
    return p;
  }

  async like(userId: string, postId: string, on: boolean) {
    const post = await this.postOrFail(postId);
    if (on) {
      const res = await this.db.insert(postLikes).values({ postId, userId }).onConflictDoNothing().returning();
      if (res.length) {
        await this.db.update(posts).set({ likeCount: sql`${posts.likeCount} + 1` }).where(eq(posts.id, postId));
        // One alert per post per hour, however many people like it in that time.
        const fresh = await this.cache.redis.set(`notif:like:${postId}`, "1", "EX", 3600, "NX").catch(() => "OK");
        if (fresh) {
          const name = await this.notifs.nameOf(userId);
          await this.notifs.create({ userId: post.authorId, kind: "post", title: `${name} liked your post`, body: excerpt(post.body), actorId: userId, targetType: "post", targetId: postId });
        }
      }
    } else {
      const res = await this.db.delete(postLikes).where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId))).returning();
      if (res.length) await this.db.update(posts).set({ likeCount: sql`greatest(${posts.likeCount} - 1, 0)` }).where(eq(posts.id, postId));
    }
    const [{ likeCount }] = await this.db.select({ likeCount: posts.likeCount }).from(posts).where(eq(posts.id, postId));
    return { ok: true, liked: on, likeCount };
  }

  async comment(userId: string, postId: string, body: string) {
    const text = body.trim();
    if (!text) throw new BadRequestException("Write a comment first.");
    const post = await this.postOrFail(postId);
    const [row] = await this.db.insert(postComments).values({ id: newId(), postId, authorId: userId, body: text }).returning();
    const [{ commentCount }] = await this.db.update(posts).set({ commentCount: sql`${posts.commentCount} + 1` })
      .where(eq(posts.id, postId)).returning({ commentCount: posts.commentCount });
    const name = await this.notifs.nameOf(userId);
    await this.notifs.create({ userId: post.authorId, kind: "comment", title: `${name} commented on your post`, body: excerpt(text), actorId: userId, targetType: "post", targetId: postId });
    return { ...row, commentCount };
  }

  /** The author changes the text of their post. */
  async editPost(userId: string, postId: string, body: string) {
    const text = body.trim();
    if (!text) throw new BadRequestException("A post can’t be empty.");
    const post = await this.postOrFail(postId);
    if (post.authorId !== userId) throw new ForbiddenException("You can only edit your own posts.");
    const [row] = await this.db.update(posts).set({ body: text }).where(eq(posts.id, postId)).returning();
    return row;
  }

  /**
   * The author deletes their post, with its likes and comments. Feeds that still
   * list its id skip it, because only existing posts are shown.
   */
  async deletePost(userId: string, postId: string) {
    const post = await this.postOrFail(postId);
    if (post.authorId !== userId) throw new ForbiddenException("You can only delete your own posts.");
    await this.db.transaction(async (tx) => {
      await tx.delete(postLikes).where(eq(postLikes.postId, postId));
      await tx.delete(postComments).where(eq(postComments.postId, postId));
      await tx.delete(posts).where(eq(posts.id, postId));
    });
    return { ok: true };
  }

  /** A comment can be removed by whoever wrote it, or by the author of the post (as on LinkedIn). */
  async deleteComment(userId: string, postId: string, commentId: string) {
    const post = await this.postOrFail(postId);
    const [c] = await this.read.select({ authorId: postComments.authorId }).from(postComments)
      .where(and(eq(postComments.id, commentId), eq(postComments.postId, postId))).limit(1);
    if (!c) throw new NotFoundException("That comment is already gone.");
    if (c.authorId !== userId && post.authorId !== userId) throw new ForbiddenException("You can only delete your own comments.");
    await this.db.delete(postComments).where(eq(postComments.id, commentId));
    const [{ commentCount }] = await this.db.update(posts).set({ commentCount: sql`greatest(${posts.commentCount} - 1, 0)` })
      .where(eq(posts.id, postId)).returning({ commentCount: posts.commentCount });
    return { ok: true, commentCount };
  }

  async comments(postId: string, limit = 20) {
    const rows = await this.read.select({
      id: postComments.id, body: postComments.body, createdAt: postComments.createdAt,
      authorId: users.id, authorName: users.name, authorType: users.type, avatarMediaId: users.avatarMediaId,
    }).from(postComments).innerJoin(users, eq(users.id, postComments.authorId))
      .where(and(eq(postComments.postId, postId), eq(postComments.hidden, false)))
      .orderBy(desc(postComments.createdAt)).limit(Math.min(limit, 50));
    return { items: rows };
  }

}

const excerpt = (t: string) => (t.length > 120 ? `${t.slice(0, 117)}…` : t);
