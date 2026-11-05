import { Global, Module, OnModuleDestroy, Inject, Injectable, Logger } from "@nestjs/common";
import Redis from "ioredis";
import { env } from "../common/env";

export const REDIS = Symbol("REDIS");

const client = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableAutoPipelining: true,   // batches commands automatically: far fewer round trips
  connectTimeout: 2000,
  commandTimeout: 500,          // a slow cache is treated as a miss, not a delay
  // If Redis is unreachable, commands fail at once instead of queueing. Requests
  // then fall through to Postgres: the app is slower, never stuck.
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 200, 5000),
});
client.on("error", (e) => new Logger("redis").warn("redis error: " + e.message));

/**
 * Cache helper. Every read path uses `wrap`: if the cache is down or slow the
 * request still succeeds by going to the database, it is just not as fast.
 */
@Injectable()
export class CacheService {
  private readonly log = new Logger("cache");
  constructor(@Inject(REDIS) public readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try { const v = await this.redis.get(key); return v ? (JSON.parse(v) as T) : null; }
    catch { return null; }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try { await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds); } catch {}
  }

  async wrap<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await load();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /** Clears cached entries by prefix without blocking Redis (SCAN, not KEYS). */
  async invalidate(prefix: string): Promise<void> {
    try {
      let cursor = "0";
      do {
        const [next, keys] = await this.redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
        cursor = next;
        if (keys.length) await this.redis.unlink(...keys);
      } while (cursor !== "0");
    } catch (e) { this.log.warn("invalidate failed: " + (e as Error).message); }
  }
}

@Global()
@Module({
  providers: [{ provide: REDIS, useValue: client }, CacheService],
  exports: [REDIS, CacheService],
})
export class RedisModule implements OnModuleDestroy {
  async onModuleDestroy() { await client.quit().catch(() => {}); }
}
