import { Job } from "bullmq";
import type { Pool } from "pg";

/**
 * Matching jobs. The scoring rules live in src/requirements/matching.ts and are
 * re-implemented here against raw SQL so the worker stays independent of Nest.
 */
import { matchScore, MATCH_THRESHOLD } from "../src/requirements/matching";

export async function runMatch(job: Job<{ requirementId?: string; listingId?: string }>, pool: Pool) {
  if (job.data.requirementId) return matchForRequirement(job.data.requirementId, pool);
  if (job.data.listingId) return matchForListing(job.data.listingId, pool);
  return { matched: 0 };
}

async function matchForRequirement(requirementId: string, pool: Pool) {
  const { rows: reqs } = await pool.query(`select * from requirements where id = $1`, [requirementId]);
  const req = reqs[0];
  if (!req) return { matched: 0 };

  const { rows: candidates } = await pool.query(
    `select id, city, locality, purpose, kind, bhk, price_inr as "priceInr", area_sqft as "areaSqft", possession
       from listings
      where status = 'active' and hidden = false and city = $1 and purpose = $2
        and ($3::bigint is null or price_inr <= $3 * 1.15)
        and ($4::bigint is null or price_inr >= $4 * 0.7)
        and ($5::int is null or bhk between $5 - 1 and $5 + 1)
      order by published_at desc
      limit 500`,
    [req.city, req.purpose, req.max_price, req.min_price, req.bhk],
  );

  const r = { city: req.city, localities: req.localities, purpose: req.purpose, kind: req.kind, bhk: req.bhk,
    minPrice: req.min_price, maxPrice: req.max_price, minArea: req.min_area, timeline: req.timeline };
  const scored = candidates.map((l: any) => ({ id: l.id, score: matchScore(l, r as never) }))
    .filter((m) => m.score >= MATCH_THRESHOLD).sort((a, b) => b.score - a.score).slice(0, 50);

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`delete from requirement_matches where requirement_id = $1`, [requirementId]);
    if (scored.length) {
      await client.query(
        `insert into requirement_matches (requirement_id, listing_id, score)
         select $1, unnest($2::text[]), unnest($3::int[])`,
        [requirementId, scored.map((s) => s.id), scored.map((s) => s.score)],
      );
    }
    await client.query(`update requirements set match_count = $2, updated_at = now() where id = $1`, [requirementId, scored.length]);
    await client.query("commit");
  } catch (e) { await client.query("rollback"); throw e; }
  finally { client.release(); }
  return { matched: scored.length };
}

async function matchForListing(listingId: string, pool: Pool) {
  const { rows: ls } = await pool.query(
    `select id, city, locality, purpose, kind, bhk, price_inr as "priceInr", area_sqft as "areaSqft", possession, status
       from listings where id = $1`, [listingId]);
  const listing = ls[0];
  if (!listing || listing.status !== "active") return { matched: 0 };

  const { rows: reqs } = await pool.query(
    `select id, city, localities, purpose, kind, bhk, min_price, max_price, min_area, timeline
       from requirements where status = 'active' and city = $1 and purpose = $2 limit 1000`,
    [listing.city, listing.purpose]);

  const hits = reqs.map((q: any) => ({
    id: q.id,
    score: matchScore(listing, { city: q.city, localities: q.localities, purpose: q.purpose, kind: q.kind,
      bhk: q.bhk, minPrice: q.min_price, maxPrice: q.max_price, minArea: q.min_area, timeline: q.timeline } as never),
  })).filter((m) => m.score >= MATCH_THRESHOLD);

  if (hits.length) {
    await pool.query(
      `insert into requirement_matches (requirement_id, listing_id, score)
       select unnest($1::text[]), $2, unnest($3::int[])
       on conflict do nothing`,
      [hits.map((h) => h.id), listingId, hits.map((h) => h.score)],
    );
    await pool.query(
      `update requirements r set match_count = (select count(*) from requirement_matches m where m.requirement_id = r.id)
        where r.id = any($1::text[])`, [hits.map((h) => h.id)]);
  }
  return { matched: hits.length };
}
