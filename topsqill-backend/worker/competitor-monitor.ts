import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Queue } from "bullmq";
import { env } from "../src/common/env";
import { searchAdLibrary, AdLibraryNotConfiguredError, type AdLibraryResult } from "../src/competitive-intelligence/ad-library";
import { fingerprintAd } from "../src/competitive-intelligence/watch";

/** No more than this many watches re-checked per run, and each watch at most once every CHECK_HOURS - a deliberately conservative pace for an API with no published commercial rate limit. */
const BATCH_SIZE = 10;
const CHECK_HOURS = 6;

type WatchRow = { id: string; owner_id: string; search_terms: string };

/**
 * Continuous Market Learning (Campaign Evolution spec, Section 11): re-runs
 * each saved competitor search at most once every CHECK_HOURS, in small
 * batches, and notifies the owner only of ads genuinely not seen on a
 * previous check (never on a watch's very first check, which just
 * establishes the baseline - otherwise every new watch would "discover"
 * everything that was already running).
 */
export async function monitorCompetitors(pool: Pool, notifyQueue?: Queue) {
  if (!env.META_APP_ID || !env.META_APP_SECRET) return { checked: 0, reason: "Meta Ad Library isn't configured" };

  const { rows } = await pool.query<WatchRow>(
    `select id, owner_id, search_terms from competitor_watches
      where last_checked_at is null or last_checked_at < now() - ($1 || ' hours')::interval
      order by last_checked_at asc nulls first
      limit $2`,
    [CHECK_HOURS, BATCH_SIZE],
  );

  let checked = 0, newAdsTotal = 0;
  for (const w of rows) {
    try {
      const { rows: seenRows } = await pool.query<{ fingerprint: string }>(`select fingerprint from competitor_watch_ads where watch_id = $1`, [w.id]);
      const seen = new Set(seenRows.map((r) => r.fingerprint));
      const isFirstCheck = seen.size === 0;

      let results: AdLibraryResult[];
      try {
        results = await searchAdLibrary({ appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, apiVersion: "v21.0", searchTerms: w.search_terms, countries: ["IN"], limit: 20 });
      } catch (e) {
        if (e instanceof AdLibraryNotConfiguredError) throw e;   // stop the whole run, not just this watch
        console.error(JSON.stringify({ severity: "ERROR", message: "competitor watch search failed", watchId: w.id, error: (e as Error).message }));
        continue;   // one bad search (rate limit, transient error) never blocks the rest of the batch
      }

      const fresh: { fingerprint: string; pageName: string; headline: string | null }[] = [];
      for (const r of results) {
        const fp = fingerprintAd(r);
        if (!seen.has(fp)) fresh.push({ fingerprint: fp, pageName: r.pageName, headline: r.headline });
      }
      for (const f of fresh) {
        await pool.query(
          `insert into competitor_watch_ads (id, watch_id, fingerprint, page_name, headline) values ($1,$2,$3,$4,$5) on conflict (watch_id, fingerprint) do nothing`,
          [randomUUID(), w.id, f.fingerprint, f.pageName.slice(0, 160), f.headline?.slice(0, 200) ?? null],
        );
      }
      await pool.query(`update competitor_watches set last_checked_at = now() where id = $1`, [w.id]);
      checked++;

      if (!isFirstCheck && fresh.length) {
        newAdsTotal += fresh.length;
        const notifId = randomUUID();
        await pool.query(
          `insert into notifications (id, user_id, kind, title, body, target_type, target_id) values ($1,$2,'competitor',$3,$4,'competitor',$5)`,
          [notifId, w.owner_id, `${fresh.length} new ad${fresh.length === 1 ? "" : "s"} found for "${w.search_terms}"`,
            `${fresh[0].pageName}${fresh.length > 1 ? ` and ${fresh.length - 1} more` : ""} - a long-running or repeated ad isn't proof it performs well, just worth a look.`, w.id],
        );
        await notifyQueue?.add("push", { notificationId: notifId }, { jobId: `push-${notifId}` }).catch(() => {});
        await notifyQueue?.add("deliver", { notificationId: notifId }, { jobId: `notif-${notifId}` }).catch(() => {});
      }
    } catch (e) {
      if (e instanceof AdLibraryNotConfiguredError) return { checked, reason: e.message };
      console.error(JSON.stringify({ severity: "ERROR", message: "competitor monitor failed", watchId: w.id, error: (e as Error).message }));
    }
  }
  return { checked, newAdsTotal };
}
