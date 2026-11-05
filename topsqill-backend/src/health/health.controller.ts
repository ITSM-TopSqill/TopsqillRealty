import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Pool } from "pg";
import Redis from "ioredis";
import { REDIS } from "../redis/redis.module";
import { Public } from "../auth/public.decorator";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    @Inject("PG_POOLS") private readonly pools: { writePool: Pool; readPool: Pool },
    @Inject(REDIS) private readonly redis: Redis,
  ) { }

  /** Cloud Run liveness: is the process up? */
  @Public() @Get("/health")
  health() { return { ok: true, uptime: Math.round(process.uptime()) }; }

  /**
   * Readiness. Only the database makes a container unfit to serve: without the
   * cache the app is slower but still correct, so a Redis outage must not take
   * the whole service out of rotation. The reason is returned either way, so a
   * failing check is diagnosable from the response alone.
   */
  @Public() @Get("/ready")
  async ready() {
    const [db, cache] = await Promise.allSettled([
      this.pools.writePool.query("select 1"),
      this.redis.ping(),
    ]);
    const redisOk = cache.status === "fulfilled";
    if (db.status === "rejected") {
      throw new ServiceUnavailableException({
        ok: false, db: false, redis: redisOk,
        message: `Database unavailable: ${(db.reason as Error)?.message ?? "unknown error"}`,
      });
    }
    return { ok: true, db: true, redis: redisOk };
  }
}
