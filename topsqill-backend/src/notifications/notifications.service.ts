import { Injectable, Inject } from "@nestjs/common";
import { and, desc, eq, isNull, sql, lt, or } from "drizzle-orm";
import Redis from "ioredis";
import { DB, DB_READ, type Database } from "../db/db.module";
import { notifications, pushTokens } from "../db/schema";
import { REDIS } from "../redis/redis.module";
import { QueueService, QUEUES } from "../queue/queue.module";
import { newId, encodeCursor, decodeCursor } from "../common/ids";

export type NewNotification = {
  userId: string;
  kind: "connection" | "message" | "lead" | "match" | "post" | "comment" | "system" | "job";
  title: string;
  body?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
};

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly queue: QueueService,
  ) {}

  /**
   * Writes the notification, bumps the unread counter in Redis (so the badge is a
   * single fast read), publishes it for any open WebSocket, and queues push/WhatsApp.
   */
  async create(n: NewNotification) {
    const [row] = await this.db.insert(notifications).values({ id: newId(), ...n }).returning();
    await this.redis.incr(`notif:unread:${n.userId}`).catch(() => {});
    await this.redis.publish(`user:${n.userId}`, JSON.stringify({ type: "notification", data: row })).catch(() => {});
    await this.queue.add(QUEUES.notify, "deliver", { notificationId: row.id, userId: n.userId }, `notif-${row.id}`);
    return row;
  }

  /** Several notifications at once (for example a new listing matching many buyers). */
  async createMany(list: NewNotification[]) {
    if (!list.length) return { created: 0 };
    const rows = list.map((n) => ({ id: newId(), ...n }));
    await this.db.insert(notifications).values(rows);
    const pipe = this.redis.pipeline();
    for (const r of rows) {
      pipe.incr(`notif:unread:${r.userId}`);
      pipe.publish(`user:${r.userId}`, JSON.stringify({ type: "notification", data: r }));
    }
    await pipe.exec().catch(() => {});
    return { created: rows.length };
  }

  async list(userId: string, cursor?: string, limit = 20) {
    limit = Math.min(Math.max(limit, 1), 50);
    const cur = decodeCursor(cursor);
    const where = [eq(notifications.userId, userId)];
    if (cur) where.push(or(lt(notifications.createdAt, new Date(cur.t)), and(eq(notifications.createdAt, new Date(cur.t)), lt(notifications.id, cur.id))!)!);
    const rows = await this.read.select().from(notifications).where(and(...where))
      .orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null };
  }

  /** The badge count comes from Redis; Postgres is only consulted if the cache is cold. */
  async unreadCount(userId: string) {
    const cached = await this.redis.get(`notif:unread:${userId}`).catch(() => null);
    if (cached !== null) return { unread: Number(cached) };
    const res = await this.read.select({ n: sql<number>`count(*)::int` }).from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    const n = res[0]?.n ?? 0;
    await this.redis.set(`notif:unread:${userId}`, n, "EX", 3600).catch(() => {});
    return { unread: n };
  }

  async markAllRead(userId: string) {
    await this.db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    await this.redis.set(`notif:unread:${userId}`, 0, "EX", 3600).catch(() => {});
    return { ok: true };
  }

  async registerPushToken(userId: string, token: string, platform: string) {
    await this.db.insert(pushTokens).values({ token, userId, platform })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform } });
    return { ok: true };
  }
}
