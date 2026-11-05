import { Controller, Get, Inject } from "@nestjs/common";
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
  ) {}

  /** Cloud Run liveness: is the process up? */
  @Public() @Get("/health")
  health() { return { ok: true, uptime: Math.round(process.uptime()) }; }

  /** Readiness: only receive traffic when the database and cache answer. */
  @Public() @Get("/ready")
  async ready() {
    const [db, cache] = await Promise.allSettled([
      this.pools.writePool.query("select 1"),
      this.redis.ping(),
    ]);
    const ok = db.status === "fulfilled" && cache.status === "fulfilled";
    if (!ok) { const e: any = new Error("not ready"); e.status = 503; throw e; }
    return { ok: true, db: true, redis: true };
  }
}
