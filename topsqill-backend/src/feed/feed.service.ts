import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { posts, postLikes, postComments, connections, follows, users, media, listings, jobs, projects } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { QueueService, QUEUES } from "../queue/queue.module";
import { MediaService } from "../media/media.service";
import { NotificationsService } from "../notifications/notifications.service";
import { newId, encodeCursor, decodeCursor } from "../common/ids";

/**
 * Feed strategy
 *  - On publish, a background job copies the post id into each connection's feed
 *    list in Redis ("fan-out on write"). Opening Home is then a single list read.
 *  - Accounts with very large followings are not fanned out; their posts are
 *    merged in at read time, so one builder with 80k followers never blocks the queue.
 */
const FANOUT_LIMIT = 5000;

export type FeedFilter = "following" | "listings" | "requirements" | "projects" | "insights";
const FILTER_KIND = { listings: "listing", requirements: "requirement", projects: "project", insights: "insight" } as const;
const FEED_KEY = (userId: string) => `feed:${userId}`;

@Injectable()
export class FeedService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly cache: CacheService,
    private readonly queue: QueueService,
    private readonly mediaSvc: MediaService,
    private readonly notifs: NotificationsService,
  ) {}

  async createPost(userId: string, input: { kind?: string; body: string; refId?: string; mediaIds?: string[] }) {
    const id = newId();
    const [row] = await this.db.insert(posts).values({
      id, authorId: userId, kind: (input.kind as any) ?? "update",
      body: input.body, refId: input.refId ?? null, mediaIds: input.mediaIds ?? [],
    }).returning();
    // The API returns now; delivery to followers happens in the background.
    await this.queue.add(QUEUES.fanout, "post", { postId: id, authorId: userId }, `fanout-${id}`);
    return row;
  }

  /**
   * Home feed: pre-built list in Redis, with a database fallback.
   *
   * Cursors say which source made them ("c:" a post id from the Redis list,
   * "d:" a time and id from Postgres). Before, the two kinds were mixed up when
   * the source changed between pages, so "load more" repeated or skipped posts.
   */
  async home(userId: string, cursor?: string, limit = 20, filter?: FeedFilter) {
    limit = Math.min(Math.max(limit, 1), 50);
    if (filter) return this.filtered(userId, filter, cursor?.startsWith("d:") ? cursor.slice(2) : undefined, limit);
    if (cursor?.startsWith("d:")) return this.homeFromDb(userId, cursor.slice(2), limit);
    const afterId = cursor?.startsWith("c:") ? cursor.slice(2) : undefined;

    const ids = await this.cache.redis.zrevrange(FEED_KEY(userId), 0, 400).catch(() => [] as string[]);
    if (ids.length && (!afterId || ids.includes(afterId))) {
      const start = afterId ? ids.indexOf(afterId) + 1 : 0;
      const slice = ids.slice(start, start + limit + 1);
      if (slice.length > limit) {
        const page = slice.slice(0, limit);
        return { items: await this.hydrate(page, userId), nextCursor: `c:${page[page.length - 1]}`, source: "cache" };
      }
      // The cached list only holds posts delivered since it was created, so it
      // runs out: carry on from Postgres after its last post, on this same page.
      // (Stopping here hid every older post from the member's network.)
      const cached = await this.hydrate(slice, userId);
      const anchorId = cached.length ? cached[cached.length - 1].id : afterId;
      const [anchor] = anchorId ? await this.read.select({ createdAt: posts.createdAt }).from(posts).where(eq(posts.id, anchorId)).limit(1) : [];
      const rest = await this.homeFromDb(userId, anchor ? encodeCursor(anchor.createdAt, anchorId!) : undefined, Math.max(limit - cached.length, 1), new Set(ids));
      const items = [...cached, ...rest.items].slice(0, limit);
      return { items, nextCursor: rest.nextCursor, source: "cache+db" };
    }
    // Past the end of the cached list (or it expired): carry on from that post in Postgres.
    if (afterId) {
      const [p] = await this.read.select({ createdAt: posts.createdAt }).from(posts).where(eq(posts.id, afterId)).limit(1);
      return this.homeFromDb(userId, p ? encodeCursor(p.createdAt, afterId) : undefined, limit);
    }
    return this.homeFromDb(userId, undefined, limit);
  }

  /**
   * The feed narrowed to one kind of post. "following" is only people I'm
   * connected with or follow; the others (listings, requirements, projects,
   * insights) are posts of that kind from everyone, so there is always
   * something to read. Always from Postgres, with "d:" cursors.
   */
  private async filtered(userId: string, filter: FeedFilter, cursor: string | undefined, limit: number) {
    const cur = decodeCursor(cursor);
    const where = [eq(posts.hidden, false)];
    if (filter === "following") {
      const authorIds = await this.audienceOf(userId);
      if (!authorIds.length) return { items: [], nextCursor: null, source: "db" };
      where.push(inArray(posts.authorId, authorIds));
    } else {
      where.push(eq(posts.kind, FILTER_KIND[filter]));
    }
    if (cur) where.push(or(lt(posts.createdAt, new Date(cur.t)), and(eq(posts.createdAt, new Date(cur.t)), lt(posts.id, cur.id))!)!);
    const rows = await this.read.select().from(posts).where(and(...where)).orderBy(desc(posts.createdAt), desc(posts.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: await this.decorate(page, userId),
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
    await this.queue.add(QUEUES.fanout, "post", { postId: id, authorId: userId }, `fanout-${id}`);
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

  /** Used for new members, and whenever the cached feed is empty. */
  private async homeFromDb(userId: string, cursor?: string, limit = 20, skip?: Set<string>) {
    const cur = decodeCursor(cursor);
    const authorIds = await this.audienceOf(userId);
    const where = [eq(posts.hidden, false)];
    if (authorIds.length) where.push(inArray(posts.authorId, [...authorIds, userId]));
    if (cur) where.push(or(lt(posts.createdAt, new Date(cur.t)), and(eq(posts.createdAt, new Date(cur.t)), lt(posts.id, cur.id))!)!);

    const rows = await this.read.select().from(posts).where(and(...where))
      .orderBy(desc(posts.createdAt), desc(posts.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    // Posts already shown from the cached list are not repeated.
    const items = await this.decorate(skip ? page.filter((p) => !skip.has(p.id)) : page, userId);
    return {
      items,
      nextCursor: hasMore && page.length ? `d:${encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)}` : null,
      source: "db",
    };
  }

  private async audienceOf(userId: string) {
    return this.cache.wrap(`audience:${userId}`, 300, async () => {
      const [conns, fols] = await Promise.all([
        this.read.select({ id: connections.peerId }).from(connections)
          .where(and(eq(connections.userId, userId), eq(connections.status, "accepted"))).limit(2000),
        this.read.select({ id: follows.targetId }).from(follows).where(eq(follows.followerId, userId)).limit(2000),
      ]);
      return [...new Set([...conns.map((c) => c.id), ...fols.map((f) => f.id)])];
    });
  }

  private async hydrate(ids: string[], viewerId: string) {
    if (!ids.length) return [];
    const rows = await this.read.select().from(posts).where(and(inArray(posts.id, ids), eq(posts.hidden, false)));
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return this.decorate(rows, viewerId);
  }

  /** Authors, media and "did I like this" are each one query for the whole page. */
  private async decorate(rows: (typeof posts.$inferSelect)[], viewerId: string, depth = 0): Promise<any[]> {
    if (!rows.length) return [];
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
    }));
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
    await this.cache.redis.zrem(FEED_KEY(userId), postId).catch(() => 0);
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

  static FANOUT_LIMIT = FANOUT_LIMIT;
  static feedKey = FEED_KEY;
}

const excerpt = (t: string) => (t.length > 120 ? `${t.slice(0, 117)}…` : t);
