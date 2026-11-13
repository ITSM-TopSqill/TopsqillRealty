import type { Pool } from "pg";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { v7 as uuidv7 } from "uuid";
import { QUEUES } from "../src/queue/queues";

/**
 * Alerts raised by background jobs (a new listing matching a buyer). Mirrors
 * NotificationsService.create, which needs Nest, so the worker has its own.
 */
let queue: Queue | null = null;

export async function raiseAlert(pool: Pool, redis: Redis, n: {
  userId: string; kind: string; title: string; body?: string | null; actorId?: string | null; targetType?: string; targetId?: string; emailDelayMs?: number;
}) {
  if (n.actorId && n.actorId === n.userId) return;
  const id = uuidv7();
  const { rows } = await pool.query(
    `insert into notifications (id, user_id, kind, title, body, actor_id, target_type, target_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [id, n.userId, n.kind, n.title.slice(0, 160), n.body?.slice(0, 300) ?? null, n.actorId ?? null, n.targetType ?? null, n.targetId ?? null]);
  await redis.publish(`user:${n.userId}`, JSON.stringify({ type: "notification", data: rows[0] })).catch(() => {});
  queue ??= new Queue(QUEUES.notify, { connection: redis });
  await queue.add("push", { notificationId: id }, { jobId: `push-${id}`, removeOnComplete: 1000, removeOnFail: 5000 }).catch(() => {});
  await queue.add("deliver", { notificationId: id }, { jobId: `notif-${id}`, delay: n.emailDelayMs ?? 60_000, removeOnComplete: 1000, removeOnFail: 5000 }).catch(() => {});
}
