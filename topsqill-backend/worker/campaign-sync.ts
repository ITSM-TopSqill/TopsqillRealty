import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Queue } from "bullmq";
import { syncAll, type Notify } from "../src/ads/runner";

/**
 * Every 15 minutes: brings spend and results back from Meta and Google for
 * running campaigns (and ones that ended in the last three days, since the
 * platforms report the last spend late), charges members' wallets for new
 * spend, and ends campaigns whose dates or budget have run out, returning
 * what's left to the wallet. The member is told when a campaign ends.
 */
export async function syncLiveCampaigns(pool: Pool, notifyQueue?: Queue) {
  const notify: Notify = async (n) => {
    const id = randomUUID();
    await pool.query(
      `insert into notifications (id, user_id, kind, title, body, target_type, target_id) values ($1,$2,'campaign',$3,$4,$5,$6)`,
      [id, n.userId, n.title.slice(0, 160), n.body?.slice(0, 300) ?? null, n.targetType, n.targetId]);
    await notifyQueue?.add("deliver", { notificationId: id }, { jobId: `notif-${id}` }).catch(() => {});
  };
  return syncAll(pool, notify);
}
