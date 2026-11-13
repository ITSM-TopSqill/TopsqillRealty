import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { inTx, queryOn, type Q } from "./db";
import { ledger, rupees } from "./ledger";
import { loadAds, type AdsSettings } from "./settings";
import { adsSecret } from "./secrets";
import { metaLaunch, metaSetStatus, metaStats, type MetaCtx } from "./meta";
import { googleLaunch, googleSetStatus, googleStats, type GoogleCtx } from "./google";

/**
 * Runs managed campaigns on Topsqill's ad accounts: launch, pause, resume,
 * end, and the regular sync that brings spend back, charges the member's
 * wallet, and stops a campaign when its days or budget run out. Shared by
 * the API (launch on approval, member's buttons) and the worker (sync).
 */
export type Platform = "meta" | "google";
export type Notify = (n: { userId: string; title: string; body?: string; targetType: string; targetId: string }) => Promise<unknown>;

export async function metaCtx(s: AdsSettings): Promise<MetaCtx | null> {
  const token = await adsSecret("meta-ads-token");
  if (!token || !s.meta.adAccountId || !s.meta.pageId) return null;
  return { token, version: s.meta.apiVersion, adAccountId: s.meta.adAccountId, pageId: s.meta.pageId, instagramUserId: s.meta.instagramUserId || undefined, housing: s.meta.housingCategory };
}
export async function googleCtx(s: AdsSettings): Promise<GoogleCtx | null> {
  const [dev, oauthRaw] = await Promise.all([adsSecret("google-ads-developer-token"), adsSecret("google-ads-oauth")]);
  if (!dev || !oauthRaw || !s.google.customerId) return null;
  try {
    const oauth = JSON.parse(oauthRaw);
    if (!oauth.client_id || !oauth.client_secret || !oauth.refresh_token) return null;
    return { version: s.google.apiVersion, customerId: s.google.customerId, loginCustomerId: s.google.loginCustomerId || undefined, developerToken: dev, oauth };
  } catch { return null; }
}

/** Which platforms can take campaigns right now (credentials and ids are all set). */
export async function readyPlatforms(q: Q) {
  const s = await loadAds(q);
  const [m, g] = await Promise.all([metaCtx(s), googleCtx(s)]);
  return { settings: s, meta: !!m, google: !!g };
}

type CampaignRow = Record<string, any>;
const webUrl = () => (process.env.WEB_URL ?? "https://topsqill.ai").replace(/\/$/, "");

/** Creates the campaign on each chosen platform that isn't live yet. One platform failing never stops the others. */
export async function launchCampaign(pool: Pool, campaignId: string) {
  const q = queryOn(pool);
  const s = await loadAds(q);
  const [c] = await q<CampaignRow>("select * from campaigns where id = $1", [campaignId]);
  if (!c) throw new Error("Campaign not found.");
  const [l] = await q<CampaignRow>("select * from listings where id = $1", [c.listing_id]);
  if (!l) throw new Error("The campaign's listing is gone.");
  const mediaIds: string[] = c.media_ids?.length ? c.media_ids : [l.cover_media_id].filter(Boolean);
  const media = mediaIds.length ? await q<{ id: string; kind: string; variants: Record<string, string> }>("select id, kind, variants from media where id = any($1) and status = 'ready'", [mediaIds]) : [];
  const base = await publicBaseUrl();
  const url = (v?: string) => (!v ? null : v.startsWith("http") ? v : `${base}/${v}`);
  const byId = new Map(media.map((m) => [m.id, m]));
  const ordered = mediaIds.map((id) => byId.get(id)).filter(Boolean) as typeof media;
  const pictures = ordered.filter((m) => m.kind === "image").map((m) => url(m.variants.large_jpeg ?? m.variants.full_jpeg ?? m.variants.original)).filter(Boolean) as string[];
  const videoRow = ordered.find((m) => m.kind === "video" && m.variants.mp4);
  if (!pictures.length && !videoRow) throw new Error("Pick at least one photo for the ads.");

  const cr = (c.creatives ?? {}) as Record<string, any>;
  const days = Math.max(Number(c.days) || 15, 1);
  const budgetPaise = Number(c.budget_inr) * 100;
  const endsAt = c.ends_at ? new Date(c.ends_at) : new Date(Date.now() + days * 86_400_000);
  const platforms: Platform[] = (c.platforms ?? []).filter((p: string) => p === "meta" || p === "google");
  const share = (p: Platform) => platforms.length === 1 ? 1 : p === "meta" ? 0.7 : 0.3;     // Meta brings most property leads
  const bhk = l.bhk ? `${l.bhk} BHK` : "";
  const place = { lat: l.lat ?? null, lng: l.lng ?? null, city: l.city };
  const results: { platform: Platform; status: "live" | "failed"; error?: string }[] = [];

  for (const platform of platforms) {
    const [live] = await q("select id from campaign_deliveries where campaign_id = $1 and platform = $2 and status = 'live'", [campaignId, platform]);
    if (live) { results.push({ platform, status: "live" }); continue; }
    const daily = Math.round((budgetPaise * share(platform)) / days);
    const deliveryId = randomUUID();
    await q("insert into campaign_deliveries (id, campaign_id, platform, budget_inr, status) values ($1,$2,$3,$4,'pending')", [deliveryId, campaignId, platform, Math.round((budgetPaise * share(platform)) / 100)]);
    const link = `${webUrl()}/listings/${l.id}?ad=${campaignId}&utm_source=${platform}&utm_medium=paid&utm_campaign=tsq_${campaignId}`;
    try {
      if (platform === "meta") {
        const ctx = await metaCtx(s);
        if (!ctx) throw new Error("Meta isn't set up (Admin → Ads).");
        const ids = await metaLaunch(ctx, {
          name: c.name, link, privacyUrl: `${webUrl()}/privacy`, purpose: l.purpose,
          headline: (cr.headlines?.[0] ?? `${bhk} in ${l.locality}`).slice(0, 60),
          primaryText: (cr.primaryTexts?.[0] ?? l.title).slice(0, 500),
          description: `${l.locality}, ${l.city}`.slice(0, 60),
          pictures, video: videoRow ? { url: url(videoRow.variants.mp4)!, thumbnail: pictures[0] ?? "" } : null,
          place: { ...place, radiusKm: s.meta.radiusKm }, dailyBudgetPaise: daily, endsAt,
        }, async (partial) => { await q("update campaign_deliveries set external = $2 where id = $1", [deliveryId, JSON.stringify(partial)]); });
        await q("update campaign_deliveries set status = 'live', external = $2, external_campaign_id = $3, synced_at = now(), error = null where id = $1", [deliveryId, JSON.stringify(ids), ids.campaignId]);
      } else {
        const ctx = await googleCtx(s);
        if (!ctx) throw new Error("Google Ads isn't set up (Admin → Ads).");
        const g = cr.googleAd ?? {};
        const rent = l.purpose === "rent";
        const ids = await googleLaunch(ctx, {
          name: c.name, finalUrl: link, dailyBudgetPaise: daily, place: { ...place, radiusKm: s.google.radiusKm },
          headlines: [...(g.headlines ?? []), `${bhk} in ${l.locality}`, rent ? `${bhk} for Rent ${l.locality}` : `${bhk} Flat for Sale`, `Verified Listing, ${l.city}`, "Book a Site Visit Today", l.possession ?? ""],
          descriptions: [...(g.descriptions ?? []), `${bhk} ${l.kind} in ${l.locality}, ${l.city}. See photos, price and location now.`, "Talk to the owner or agent directly. Free site visit."],
          keywords: keywordsFor(l),
        });
        await q("update campaign_deliveries set status = 'live', external = $2, external_campaign_id = $3, synced_at = now(), error = null where id = $1", [deliveryId, JSON.stringify(ids), ids.campaignId]);
      }
      results.push({ platform, status: "live" });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await q("update campaign_deliveries set status = 'failed', error = $2 where id = $1", [deliveryId, msg]);
      results.push({ platform, status: "failed", error: msg });
    }
  }
  if (results.some((r) => r.status === "live")) {
    await q(`update campaigns set status = 'active', launched_at = coalesce(launched_at, now()), ends_at = coalesce(ends_at, $2), updated_at = now() where id = $1`, [campaignId, endsAt]);
  }
  return results;
}

function keywordsFor(l: CampaignRow) {
  const bhk = l.bhk ? `${l.bhk} bhk` : "";
  const kind = String(l.kind ?? "flat").toLowerCase();
  const loc = String(l.locality ?? "").toLowerCase(), city = String(l.city ?? "").toLowerCase();
  const verb = l.purpose === "rent" ? "for rent" : "for sale";
  return [
    `${bhk} ${loc}`, `${bhk} flat ${verb} in ${loc}`, `${bhk} ${kind} ${loc} ${city}`, `flat ${verb} in ${loc}`,
    `${kind} ${verb} ${loc}`, `property in ${loc}`, `${bhk} ${verb} ${city}`, `${loc} ${city} ${kind}`,
    l.purpose === "rent" ? `house for rent ${loc}` : `buy ${bhk} ${loc}`,
  ].map((k) => k.replace(/\s+/g, " ").trim()).filter((k) => k.split(" ").length >= 2);
}

async function publicBaseUrl() {
  const { publicBase } = await import("../media/storage");
  return publicBase();
}

/** Pauses or resumes the campaign on every platform it's live on. */
export async function setLive(pool: Pool, campaignId: string, on: boolean) {
  const q = queryOn(pool);
  const s = await loadAds(q);
  const ds = await q<CampaignRow>("select * from campaign_deliveries where campaign_id = $1 and status in ('live','paused') and external_campaign_id is not null", [campaignId]);
  const errors: string[] = [];
  for (const d of ds) {
    try {
      if (d.platform === "meta") { const ctx = await metaCtx(s); if (ctx) await metaSetStatus(ctx, d.external_campaign_id, on); }
      if (d.platform === "google") { const ctx = await googleCtx(s); if (ctx) await googleSetStatus(ctx, d.external_campaign_id, on); }
      await q("update campaign_deliveries set status = $2 where id = $1", [d.id, on ? "live" : "paused"]);
    } catch (e) { errors.push(`${d.platform}: ${(e as Error).message}`); }
  }
  return { errors };
}

/**
 * Brings the latest spend and results back, charges the wallet for new spend
 * (plus Topsqill's fee), and ends the campaign when its time or money is up.
 */
export async function syncCampaign(pool: Pool, campaignId: string, notify?: Notify) {
  const q = queryOn(pool);
  const s = await loadAds(q);
  const [c] = await q<CampaignRow>("select * from campaigns where id = $1", [campaignId]);
  if (!c) return null;
  const ds = await q<CampaignRow>("select * from campaign_deliveries where campaign_id = $1 and external_campaign_id is not null and status in ('live','paused')", [campaignId]);
  let spend = 0, clicks = 0, impressions = 0;
  for (const d of ds) {
    try {
      const st = d.platform === "meta"
        ? await (async () => { const ctx = await metaCtx(s); return ctx ? metaStats(ctx, d.external_campaign_id) : null; })()
        : await (async () => { const ctx = await googleCtx(s); return ctx ? googleStats(ctx, d.external_campaign_id) : null; })();
      if (st) {
        await q("update campaign_deliveries set stats = $2, spend_paise = $3, synced_at = now() where id = $1", [d.id, JSON.stringify(st), st.spendPaise]);
        d.spend_paise = st.spendPaise; d.stats = st;
      }
    } catch { /* keep the last numbers; try again next time */ }
    spend += Number(d.spend_paise ?? 0); clicks += Number(d.stats?.clicks ?? 0); impressions += Number(d.stats?.impressions ?? 0);
  }
  const fee = Number(c.fee_pct ?? 0);
  const target = Math.round(spend * (1 + fee / 100));
  const [{ n: leads }] = await q<{ n: number }>("select count(*)::int as n from leads where campaign_id = $1", [campaignId]);

  await inTx(pool, async (tq) => {
    const [cur] = await tq<CampaignRow>("select charged_paise, hold_paise, owner_id from campaigns where id = $1 for update", [campaignId]);
    const delta = target - Number(cur.charged_paise);
    let charged = 0;
    if (delta > 0) {
      const holdLeft = c.status === "active" || c.status === "paused" ? Number(cur.hold_paise) - Number(cur.charged_paise) : 0;
      charged = await ledger.spend(tq, cur.owner_id, campaignId, delta, holdLeft, `spend:${campaignId}:${target}`, `Ad spend${fee ? ` + ${fee}% fee` : ""}`);
    }
    await tq(`update campaigns set charged_paise = charged_paise + $2, spend_inr = $3, clicks_count = $4, impressions_count = $5, leads_count = $6, updated_at = now() where id = $1`,
      [campaignId, charged, Math.round(spend / 100), clicks, impressions, leads]);
  });

  // Time or money up: stop it on the platforms and give back what's left.
  const [after] = await q<CampaignRow>("select * from campaigns where id = $1", [campaignId]);
  if (after.status === "active" || after.status === "paused") {
    const timeUp = after.ends_at && new Date(after.ends_at).getTime() <= Date.now();
    const moneyUp = Number(after.charged_paise) >= Number(after.hold_paise) * 0.98;
    if (timeUp || moneyUp) await endCampaign(pool, campaignId, timeUp ? "Ended on schedule" : "Budget used", notify);
  }
  return { spendPaise: spend, clicks, impressions, leads };
}

/** Stops the campaign everywhere, marks it finished, and returns unspent money to the wallet. */
export async function endCampaign(pool: Pool, campaignId: string, reason: string, notify?: Notify) {
  const q = queryOn(pool);
  await setLive(pool, campaignId, false);
  const result = await inTx(pool, async (tq) => {
    const [c] = await tq<CampaignRow>("select * from campaigns where id = $1 for update", [campaignId]);
    if (!c || c.status === "completed") return null;
    const left = Math.max(Number(c.hold_paise) - Number(c.charged_paise), 0);
    await ledger.release(tq, c.owner_id, campaignId, left, `release:${campaignId}:end`, "Unspent budget returned");
    await tq("update campaigns set status = 'completed', end_reason = $2, ends_at = least(coalesce(ends_at, now()), now()), updated_at = now() where id = $1", [campaignId, reason]);
    return { ownerId: c.owner_id as string, left, charged: Number(c.charged_paise), name: c.name as string, leads: Number(c.leads_count) };
  });
  if (result && notify) {
    await notify({ userId: result.ownerId, title: `Campaign finished: ${reason.toLowerCase()}`,
      body: `${result.name.slice(0, 80)} · ${result.leads} lead${result.leads === 1 ? "" : "s"} · ${rupees(result.charged)} spent${result.left ? ` · ${rupees(result.left)} back in your wallet` : ""}`,
      targetType: "campaign", targetId: campaignId }).catch(() => null);
  }
  return result;
}

/**
 * The worker's regular run: every live or paused campaign, plus ones that
 * ended in the last three days (platforms report the last spend late).
 */
export async function syncAll(pool: Pool, notify?: Notify) {
  const q = queryOn(pool);
  const rows = await q<{ id: string }>(`select id from campaigns
     where status in ('active','paused') or (status = 'completed' and launched_at is not null and ends_at > now() - interval '3 days')`);
  let done = 0;
  for (const r of rows) { await syncCampaign(pool, r.id, notify).catch(() => null); done++; }
  return { synced: done };
}
