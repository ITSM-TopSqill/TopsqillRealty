import { Global, Module, OnModuleDestroy, Inject } from "@nestjs/common";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "../common/env";

export type Database = NodePgDatabase<typeof schema>;
export const DB = Symbol("DB");            // writes and anything read-after-write
export const DB_READ = Symbol("DB_READ");  // heavy reads; falls back to the primary

function makePool(url: string) {
  return new Pool({
    connectionString: url,
    // Cloud SQL accepts encrypted connections only. Its certificate is issued by
    // Google's own authority rather than a public one, so the chain is not
    // verified here; the connection is still encrypted, and it only ever travels
    // inside the private VPC. Local development needs no TLS at all.
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
    // Each container keeps a small pool. PgBouncer in front multiplexes these
    // onto far fewer real Postgres connections, so hundreds of containers are fine.
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // No query may run longer than 10s: one bad query can never block the service.
    statement_timeout: 10_000,
    query_timeout: 10_000,
    application_name: "topsqill-api",
  });
}

/**
 * The pools are created when the module starts, not when the file is imported.
 * That keeps importing any service free of side effects, so tests and tooling
 * never need a live database just to load a file.
 */
let pools: { writePool: Pool; readPool: Pool } | null = null;
function getPools() {
  if (!pools) {
    const writePool = makePool(env.DATABASE_URL);
    const readPool = env.DATABASE_URL_REPLICA ? makePool(env.DATABASE_URL_REPLICA) : writePool;
    pools = { writePool, readPool };
  }
  return pools;
}

@Global()
@Module({
  providers: [
    { provide: DB, useFactory: () => drizzle(getPools().writePool, { schema }) },
    { provide: DB_READ, useFactory: () => drizzle(getPools().readPool, { schema }) },
    { provide: "PG_POOLS", useFactory: () => getPools() },
  ],
  exports: [DB, DB_READ, "PG_POOLS"],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject("PG_POOLS") private readonly pools: { writePool: Pool; readPool: Pool }) { }
  async onModuleDestroy() {
    await this.pools.writePool.end().catch(() => { });
    if (this.pools.readPool !== this.pools.writePool) await this.pools.readPool.end().catch(() => { });
  }
}
