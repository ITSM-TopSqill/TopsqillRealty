import { Injectable, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DB_READ, type Database } from "../db/db.module";
import { CacheService } from "../redis/redis.module";
import { publicBase } from "../media/storage";

/**
 * One search box across people, listings and localities.
 * Uses Postgres full-text search for listings and trigram similarity for names,
 * so "Golf Corse Road" still finds "Golf Course Road".
 */
@Injectable()
export class SearchService {
  constructor(@Inject(DB_READ) private readonly read: Database, private readonly cache: CacheService) {}

  /**
   * Search across people, listings, localities and jobs.
   *
   * Every word may be the start of a word ("gurg" finds Gurgaon, "sec 6"
   * finds Sector 65), typos in names and localities still match (trigrams),
   * "3bhk" and "3 bhk" both work, and "3 BHK" narrows listings to three
   * bedrooms. Before, a listing matched only if every word was spelled in
   * full, and people only by name.
   */
  async suggest(q: string, limit = 5, only?: "people" | "listings" | "localities" | "jobs") {
    const term = q.trim().replace(/\s+/g, " ");
    if (term.length < 2) return { people: [], listings: [], localities: [], jobs: [] };
    const words = term.toLowerCase().replace(/(\d)\s*bhk/g, "$1 bhk").split(/[^a-z0-9]+/)
      .filter((w) => w && !STOP.has(w)).slice(0, 8);
    if (!words.length) return { people: [], listings: [], localities: [], jobs: [] };
    // Only letters and digits reach to_tsquery, so the query syntax cannot be injected.
    const prefix = words.map((w) => `${w}:*`).join(" & ");
    const bhk = Number(term.toLowerCase().match(/(\d)\s*bhk/)?.[1]) || null;
    const like = `%${term}%`;
    // Localities are matched on the place alone: "3 BHK Sector 65" means Sector 65.
    const place = term.replace(/\d\s*bhk/gi, " ").replace(/\s+/g, " ").trim() || term;
    const placeLike = `%${place}%`;
    const placeWords = words.filter((w) => w !== "bhk" && !/^\d$/.test(w) || /^\d{2,}$/.test(w));
    const placePrefix = (placeWords.length ? placeWords : words).map((w) => `${w}:*`).join(" & ");
    const want = (k: string) => !only || only === k;

    return this.cache.wrap(`search:${only ?? "all"}:${term.toLowerCase()}:${limit}`, 60, async () => {
      const [people, listingRows, localities, jobs] = await Promise.all([
        want("people") ? this.read.execute(sql`
          select id, name, type, headline, city, agency, avatar_media_id as "avatarMediaId",
                 kyc_verified as "kycVerified", rera_verified as "reraVerified", connection_count as "connectionCount"
          from users
          where status = 'active' and (
            name ilike ${like} or agency ilike ${like} or headline ilike ${like} or city ilike ${like}
            or similarity(name, ${term}) > 0.3
            or to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(agency,'') || ' ' || coalesce(city,'') || ' ' || coalesce(headline,'')) @@ to_tsquery('simple', ${prefix}))
          order by (name ilike ${like}) desc, similarity(name, ${term}) desc, kyc_verified desc, connection_count desc
          limit ${limit}`) : [],
        want("listings") ? this.read.execute(sql`
          select l.id, l.title, l.price_inr as "priceInr", l.purpose, l.kind, l.bhk, l.area_sqft as "areaSqft", l.city, l.locality,
                 l.possession, l.verified, l.published_at as "publishedAt", l.cover_media_id as "coverMediaId",
                 m.variants as "coverVariants", m.group_name as "coverGroup"
          from listings l left join media m on m.id = l.cover_media_id
          where l.status = 'active' and l.hidden = false
            and (${bhk}::int is null or l.bhk = ${bhk}::int)
            and (
              to_tsvector('simple', coalesce(l.title,'') || ' ' || coalesce(l.locality,'') || ' ' || coalesce(l.city,'') || ' ' || coalesce(l.kind,'') || ' ' || coalesce(l.description,''))
                @@ to_tsquery('simple', ${prefix})
              or similarity(l.locality, ${term}) > 0.35)
          order by ts_rank(to_tsvector('simple', coalesce(l.title,'') || ' ' || coalesce(l.locality,'') || ' ' || coalesce(l.city,'')), to_tsquery('simple', ${prefix})) desc,
                   l.verified desc, l.published_at desc
          limit ${limit}`) : [],
        want("localities") ? this.read.execute(sql`
          select locality, city, count(*)::int as listings,
                 round(avg(price_inr / nullif(area_sqft,0)) filter (where purpose = 'sale'))::int as "avgRate"
          from listings
          where status = 'active' and hidden = false
            and (locality ilike ${placeLike} or city ilike ${placeLike} or similarity(locality, ${place}) > 0.4
                 or to_tsvector('simple', locality || ' ' || city) @@ to_tsquery('simple', ${placePrefix}))
          group by locality, city
          order by (locality ilike ${placeLike}) desc, count(*) desc
          limit ${limit}`) : [],
        want("jobs") ? this.read.execute(sql`
          select id, title, company, city, locality, category, salary_min as "salaryMin", salary_max as "salaryMax", created_at as "createdAt"
          from jobs
          where status = 'open' and (title ilike ${like} or company ilike ${like} or category ilike ${like}
            or to_tsvector('simple', title || ' ' || company || ' ' || city || ' ' || coalesce(locality,'')) @@ to_tsquery('simple', ${prefix}))
          order by created_at desc
          limit ${limit}`) : [],
      ]);
      return {
        people: rows(people),
        listings: rows(listingRows).map(({ coverVariants, coverGroup, ...l }) => ({ ...l, cover: coverOf(coverVariants as Record<string, string> | null, coverGroup as string | null) })),
        localities: rows(localities),
        jobs: rows(jobs),
      };
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
/** Small words that would otherwise have to appear in every match. */
const STOP = new Set(["in", "at", "for", "the", "a", "an", "of", "near", "and", "to", "with", "on"]);

/** Card-sized photo links for a listing cover (private documents never have any). */
function coverOf(variants: Record<string, string> | null, group: string | null) {
  if (!variants || group === "private") return null;
  const base = publicBase();
  const urls: Record<string, string> = {};
  for (const [k, v] of Object.entries(variants)) urls[k] = v.startsWith("http") ? v : `${base}/${v}`;
  return { urls };
}

function rows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] })?.rows) ?? [];
}
