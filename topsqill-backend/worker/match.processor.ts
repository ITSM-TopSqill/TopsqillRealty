import { Job } from "bullmq";
import type { Pool } from "pg";

/**
 * Matching jobs. The scoring rules live in src/requirements/matching.ts and are
 * re-implemented here against raw SQL so the worker stays independent of Nest.
 */
import type Redis from "ioredis";
import { matchScore, MATCH_THRESHOLD } from "../src/requirements/matching";
import { raiseAlert } from "./alerts";

export async function runMatch(job: Job<{ requirementId?: string; listingId?: string }>, pool: Pool, redis: Redis) {
  if (job.data.requirementId) return matchForRequirement(job.data.requirementId, pool, redis);
  if (job.data.listingId) return matchForListing(job.data.listingId, pool, redis);
  return { matched: 0 };
}

async function matchForRequirement(requirementId: string, pool: Pool, redis: Redis) {
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

  const { rows: before } = await pool.query(`select listing_id from requirement_matches where requirement_id = $1`, [requirementId]);
  const known = new Set(before.map((r: { listing_id: string }) => r.listing_id));
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
  const fresh = scored.filter((m) => !known.has(m.id)).length;
  if (fresh) {
    await raiseAlert(pool, redis, {
      userId: req.user_id, kind: "match", targetType: "requirement", targetId: requirementId,
      title: `${fresh} listing${fresh === 1 ? "" : "s"} match your requirement`,
      body: `${req.bhk ? `${req.bhk} BHK ` : ""}${req.kind} in ${(req.localities ?? []).join(", ") || req.city}`,
    });
  }
  return { matched: scored.length };
}

async function matchForListing(listingId: string, pool: Pool, redis: Redis) {
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
    const { rows: added } = await pool.query(
      `insert into requirement_matches (requirement_id, listing_id, score, notified)
       select unnest($1::text[]), $2, unnest($3::int[]), true
       on conflict do nothing returning requirement_id`,
      [hits.map((h) => h.id), listingId, hits.map((h) => h.score)],
    );
    // Tell each buyer once about a listing that newly fits what they asked for.
    if (added.length) {
      const { rows: info } = await pool.query(
        `select l.title, l.owner_id, l.price_inr, r.id as rid, r.user_id from listings l, requirements r
          where l.id = $1 and r.id = any($2::text[])`, [listingId, added.map((a: { requirement_id: string }) => a.requirement_id).slice(0, 50)]);
      for (const r of info) {
        await raiseAlert(pool, redis, {
          userId: r.user_id, kind: "match", actorId: r.owner_id, targetType: "listing", targetId: listingId,
          title: "A new listing matches your requirement", body: r.title,
        });
      }
      if (info[0]) {
        await raiseAlert(pool, redis, {
          userId: info[0].owner_id, kind: "match", targetType: "listing", targetId: listingId,
          title: `Your listing matches ${added.length} buyer requirement${added.length === 1 ? "" : "s"}`, body: info[0].title,
          emailDelayMs: 5 * 60_000,
        });
      }
    }
    await pool.query(
      `update requirements r set match_count = (select count(*) from requirement_matches m where m.requirement_id = r.id)
        where r.id = any($1::text[])`, [hits.map((h) => h.id)]);
  }
  return { matched: hits.length };
}
