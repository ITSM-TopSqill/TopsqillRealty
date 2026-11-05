import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { posts, postLikes, postComments, connections, follows, users, media } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { QueueService, QUEUES } from "../queue/queue.module";
import { MediaService } from "../media/media.service";
import { newId, encodeCursor, decodeCursor } from "../common/ids";

/**
 * Feed strategy
 *  - On publish, a background job copies the post id into each connection's feed
 *    list in Redis ("fan-out on write"). Opening Home is then a single list read.
 *  - Accounts with very large followings are not fanned out; their posts are
 *    merged in at read time, so one builder with 80k followers never blocks the queue.
 */
const FANOUT_LIMIT = 5000;
const FEED_KEY = (userId: string) => `feed:${userId}`;

@Injectable()
export class FeedService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly cache: CacheService,
    private readonly queue: QueueService,
    private readonly mediaSvc: MediaService,
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

  /** Home feed: pre-built list in Redis, with a database fallback. */
  async home(userId: string, cursor?: string, limit = 20) {
    limit = Math.min(Math.max(limit, 1), 50);
    const ids = await this.cache.redis.zrevrange(FEED_KEY(userId), 0, 400).catch(() => [] as string[]);
    if (ids.length) {
      const start = cursor ? ids.indexOf(cursor) + 1 : 0;
      const slice = ids.slice(start, start + limit + 1);
      if (slice.length) {
        const hasMore = slice.length > limit;
        const page = hasMore ? slice.slice(0, limit) : slice;
        const items = await this.hydrate(page, userId);
        return { items, nextCursor: hasMore ? page[page.length - 1] : null, source: "cache" };
      }
    }
    return this.homeFromDb(userId, cursor, limit);
  }

  /** Used for new members, and whenever the cached feed is empty. */
  private async homeFromDb(userId: string, cursor?: string, limit = 20) {
    const cur = decodeCursor(cursor);
    const authorIds = await this.audienceOf(userId);
    const where = [eq(posts.hidden, false)];
    if (authorIds.length) where.push(inArray(posts.authorId, [...authorIds, userId]));
    if (cur) where.push(or(lt(posts.createdAt, new Date(cur.t)), and(eq(posts.createdAt, new Date(cur.t)), lt(posts.id, cur.id))!)!);

    const rows = await this.read.select().from(posts).where(and(...where))
      .orderBy(desc(posts.createdAt), desc(posts.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await this.decorate(page, userId);
    return {
      items,
      nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null,
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
  private async decorate(rows: (typeof posts.$inferSelect)[], viewerId: string) {
    if (!rows.length) return [];
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
    }));
  }

  async like(userId: string, postId: string, on: boolean) {
    if (on) {
      const res = await this.db.insert(postLikes).values({ postId, userId }).onConflictDoNothing().returning();
      if (res.length) await this.db.update(posts).set({ likeCount: sql`${posts.likeCount} + 1` }).where(eq(posts.id, postId));
    } else {
      const res = await this.db.delete(postLikes).where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId))).returning();
      if (res.length) await this.db.update(posts).set({ likeCount: sql`greatest(${posts.likeCount} - 1, 0)` }).where(eq(posts.id, postId));
    }
    return { ok: true, liked: on };
  }

  async comment(userId: string, postId: string, body: string) {
    const [row] = await this.db.insert(postComments).values({ id: newId(), postId, authorId: userId, body }).returning();
    await this.db.update(posts).set({ commentCount: sql`${posts.commentCount} + 1` }).where(eq(posts.id, postId));
    return row;
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
