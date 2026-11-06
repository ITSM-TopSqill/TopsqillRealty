import type { PoolConfig } from "pg";

/**
 * One place that decides how to connect to PostgreSQL.
 *
 * Cloud SQL accepts encrypted connections only, and its certificate is issued by
 * Google's own authority rather than a public one, so the chain is not verified
 * here. The connection is still encrypted and never leaves the private VPC.
 * Local development needs no TLS at all.
 *
 * The API, the migration runner and the seed script all use this, so none of
 * them can drift apart again.
 */
export function poolConfig(url: string, extra: PoolConfig = {}): PoolConfig {
    const isLocal = /@(localhost|127\.0\.0\.1|db|host\.docker\.internal)[:/]/.test(url);
    return {
        connectionString: url,
        ssl: isLocal ? undefined : { rejectUnauthorized: false },
        ...extra,
    };
}
