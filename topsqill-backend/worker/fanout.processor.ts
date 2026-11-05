import { Job } from "bullmq";
import type { Pool } from "pg";
import type Redis from "ioredis";

const FANOUT_LIMIT = 5000;   // above this, the post is merged in at read time instead
const FEED_MAX = 500;        // keep each cached feed small and fast

/**
 * Copies a new post into each connection's and follower's cached feed.
 * Done in batches with a Redis pipeline, so 5,000 followers is a handful of
 * round trips rather than 5,000.
 */
export async function fanoutPost(job: Job<{ postId: string; authorId: string }>, pool: Pool, redis: Redis) {
  const { postId, authorId } = job.data;
  const { rows: countRows } = await pool.query<{ n: string }>(
    `select (select count(*) from connections where user_id = $1 and status = 'accepted')
          + (select count(*) from follows where target_id = $1) as n`, [authorId]);
  const audience = Number(countRows[0]?.n ?? 0);
  if (audience > FANOUT_LIMIT) return { skipped: "large-account", audience };

  const score = Date.now();
  let delivered = 0;
  for (const sql of [
    `select peer_id as id from connections where user_id = $1 and status = 'accepted'`,
    `select follower_id as id from follows where target_id = $1`,
  ]) {
    const cursor = await pool.query<{ id: string }>(sql, [authorId]);
    for (let i = 0; i < cursor.rows.length; i += 500) {
      const batch = cursor.rows.slice(i, i + 500);
      const pipe = redis.pipeline();
      for (const r of batch) {
        pipe.zadd(`feed:${r.id}`, score, postId);
        pipe.zremrangebyrank(`feed:${r.id}`, 0, -(FEED_MAX + 1));  // trim oldest
        pipe.expire(`feed:${r.id}`, 7 * 24 * 3600);
      }
      await pipe.exec();
      delivered += batch.length;
    }
  }
  // The author sees their own post immediately.
  await redis.zadd(`feed:${authorId}`, score, postId);
  return { delivered };
}
