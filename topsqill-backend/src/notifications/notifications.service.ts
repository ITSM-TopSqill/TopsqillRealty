import { Injectable, Inject } from "@nestjs/common";
import { and, desc, eq, isNull, sql, lt, or, inArray } from "drizzle-orm";
import Redis from "ioredis";
import { DB, DB_READ, type Database } from "../db/db.module";
import { notifications, pushTokens, users } from "../db/schema";
import { REDIS } from "../redis/redis.module";
import { QueueService, QUEUES } from "../queue/queue.module";
import { newId, encodeCursor, decodeCursor } from "../common/ids";

export type NotifKind = "connection" | "message" | "lead" | "match" | "post" | "comment" | "system" | "job" | "listing" | "campaign";
export type NewNotification = {
  userId: string;
  kind: NotifKind;
  title: string;
  body?: string | null;
  actorId?: string;
  targetType?: string;
  targetId?: string;
};

/**
 * How long to wait before emailing about an alert. Messages wait two minutes,
 * so someone already chatting in the app is not emailed about every reply;
 * the worker skips the email if the alert was read in the meantime.
 */
const EMAIL_DELAY_MS: Partial<Record<NotifKind, number>> = { message: 120_000, connection: 30_000, lead: 0, job: 30_000, match: 60_000, comment: 60_000, listing: 0, campaign: 0 };

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly queue: QueueService,
  ) {}

  /**
   * Writes the alert, publishes it for any open connection, and queues
   * delivery by email (and push, once the app has push tokens). A member is
   * never alerted about their own action.
   */
  async create(n: NewNotification) {
    if (n.actorId && n.actorId === n.userId) return null;
    const [row] = await this.db.insert(notifications).values({ id: newId(), ...n, body: n.body?.slice(0, 300) ?? null, title: n.title.slice(0, 160) }).returning();
    await this.redis.publish(`user:${n.userId}`, JSON.stringify({ type: "notification", data: row })).catch(() => {});
    // A push to the member's phones goes straight away; the worker skips it when they have no app or turned it off.
    await this.queue.add(QUEUES.notify, "push", { notificationId: row.id }, `push-${row.id}`).catch(() => {});
    const delay = EMAIL_DELAY_MS[n.kind];
    if (delay !== undefined) {
      await this.queue.add(QUEUES.notify, "deliver", { notificationId: row.id }, `notif-${row.id}`, { delay }).catch(() => {});
    }
    return row;
  }

  /** Several notifications at once (for example a new listing matching many buyers). */
  async createMany(list: NewNotification[]) {
    for (const n of list) await this.create(n);
    return { created: list.length };
  }

  /** The member who did something, by name, for alert titles. */
  async nameOf(userId: string) {
    const [u] = await this.read.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.name ?? "A member";
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

  /**
   * Counted from Postgres every time. A Redis counter used to drift (it was
   * only ever increased), so badges showed numbers that never went away.
   * The partial index on unread rows keeps this a tiny index scan.
   */
  async unreadCount(userId: string) {
    const res = await this.read.select({ n: sql<number>`count(*)::int` }).from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { unread: res[0]?.n ?? 0 };
  }

  /** The newest unread alerts, for the pop-up shown while browsing. */
  async latestUnread(userId: string, limit = 3) {
    const rows = await this.read.select().from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .orderBy(desc(notifications.createdAt)).limit(limit);
    return { items: rows };
  }

  async markRead(userId: string, ids: string[]) {
    if (!ids.length) return { ok: true };
    await this.db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids), isNull(notifications.readAt)));
    return { ok: true };
  }

  /** Alerts about one thing (a chat, a lead) are read once the member opens it. */
  async markReadFor(userId: string, targetType: string, targetId: string) {
    await this.db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.targetType, targetType), eq(notifications.targetId, targetId), isNull(notifications.readAt)));
  }

  async markAllRead(userId: string) {
    await this.db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { ok: true };
  }

  async registerPushToken(userId: string, token: string, platform: string) {
    await this.db.insert(pushTokens).values({ token, userId, platform })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform } });
    return { ok: true };
  }
}
