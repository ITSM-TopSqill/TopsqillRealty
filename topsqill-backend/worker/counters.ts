import type { Pool } from "pg";
import type Redis from "ioredis";

/**
 * View counts are incremented in Redis on every request and written to Postgres
 * in one batched statement every 30 seconds. A popular listing therefore causes
 * one database write per half-minute instead of thousands.
 */
export async function flushCounters(pool: Pool, redis: Redis) {
  const key = "listing:views";
  const temp = `${key}:flush:${Date.now()}`;
  const exists = await redis.exists(key);
  if (!exists) return { flushed: 0 };
  await redis.rename(key, temp);                 // new views keep accumulating in a fresh hash
  const data = await redis.hgetall(temp);
  await redis.del(temp);
  const entries = Object.entries(data);
  if (!entries.length) return { flushed: 0 };

  const ids = entries.map(([id]) => id);
  const counts = entries.map(([, n]) => Number(n) || 0);
  await pool.query(
    `update listings as l set view_count = l.view_count + v.n
       from (select unnest($1::text[]) as id, unnest($2::int[]) as n) as v
      where l.id = v.id`,
    [ids, counts],
  );
  return { flushed: entries.length };
}
