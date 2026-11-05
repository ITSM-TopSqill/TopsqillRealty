import type { Pool } from "pg";

/**
 * Marks campaigns finished once their run is over, so members never see a
 * campaign as "active" after its budget period has passed.
 *
 * Pulling live spend from the ad platforms happens in the API service, which
 * holds the credentials; this worker drives the schedule and the tidying up.
 */
export async function syncLiveCampaigns(pool: Pool) {
  const { rows } = await pool.query<{ id: string; days: number; launched_at: Date }>(
    `select id, days, launched_at from campaigns where status = 'active' and launched_at is not null`,
  );
  let completed = 0;
  for (const c of rows) {
    const endsAt = new Date(c.launched_at).getTime() + c.days * 86_400_000;
    if (Date.now() > endsAt) {
      await pool.query(`update campaigns set status = 'completed', updated_at = now() where id = $1`, [c.id]);
      await pool.query(`update campaign_deliveries set status = 'paused' where campaign_id = $1 and status = 'live'`, [c.id]);
      completed++;
    }
  }
  return { checked: rows.length, completed };
}
