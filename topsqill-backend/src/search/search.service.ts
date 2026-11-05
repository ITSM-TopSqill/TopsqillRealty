import { Injectable, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DB_READ, type Database } from "../db/db.module";
import { CacheService } from "../redis/redis.module";

/**
 * One search box across people, listings and localities.
 * Uses Postgres full-text search for listings and trigram similarity for names,
 * so "Golf Corse Road" still finds "Golf Course Road".
 */
@Injectable()
export class SearchService {
  constructor(@Inject(DB_READ) private readonly read: Database, private readonly cache: CacheService) {}

  async suggest(q: string, limit = 5) {
    const term = q.trim();
    if (term.length < 2) return { people: [], listings: [], localities: [] };

    return this.cache.wrap(`suggest:${term.toLowerCase()}:${limit}`, 60, async () => {
      const [people, listingRows, localities] = await Promise.all([
        this.read.execute(sql`
          select id, name, type, headline, city, avatar_media_id as "avatarMediaId", kyc_verified as "kycVerified"
          from users
          where status = 'active' and (name ilike ${"%" + term + "%"} or similarity(name, ${term}) > 0.3)
          order by similarity(name, ${term}) desc, connection_count desc
          limit ${limit}`),
        this.read.execute(sql`
          select id, title, price_inr as "priceInr", purpose, bhk, city, locality, cover_media_id as "coverMediaId"
          from listings
          where status = 'active' and hidden = false
            and to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(locality,'') || ' ' || coalesce(city,'') || ' ' || coalesce(description,''))
                @@ plainto_tsquery('simple', ${term})
          order by published_at desc
          limit ${limit}`),
        this.read.execute(sql`
          select locality, city, count(*)::int as listings, round(avg(price_inr / nullif(area_sqft,0)))::int as "avgRate"
          from listings
          where status = 'active' and purpose = 'sale'
            and (locality ilike ${"%" + term + "%"} or city ilike ${"%" + term + "%"})
          group by locality, city
          order by count(*) desc
          limit ${limit}`),
      ]);
      return { people: rows(people), listings: rows(listingRows), localities: rows(localities) };
    });
  }

  /** Price statistics for a locality, used on listing pages and in insights. */
  async localityStats(locality: string, city?: string) {
    return this.cache.wrap(`locstats:${city ?? ""}:${locality.toLowerCase()}`, 600, async () => {
      const res = await this.read.execute(sql`
        select locality, city,
               count(*)::int as listings,
               round(avg(price_inr / nullif(area_sqft,0)))::int as "avgRatePerSqft",
               round(percentile_cont(0.5) within group (order by price_inr))::bigint as "medianPrice"
        from listings
        where status = 'active' and purpose = 'sale' and locality ilike ${locality}
          ${city ? sql`and city ilike ${city}` : sql``}
        group by locality, city
        limit 1`);
      return rows(res)[0] ?? null;
    });
  }
}

/** Drizzle returns either an array or a `{ rows }` object depending on the driver. */
function rows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] })?.rows) ?? [];
}
