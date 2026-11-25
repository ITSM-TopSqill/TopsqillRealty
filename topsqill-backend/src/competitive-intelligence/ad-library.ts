/**
 * Meta Ad Library (the public, official "approved source" named in the
 * Competitive Intelligence spec). Uses an app access token
 * (`{app_id}|{app_secret}`, Meta's standard unauthenticated-server
 * credential - no per-user OAuth needed), which is enough for the
 * ads_archive endpoint's general (non-political/non-social-issue) search.
 *
 * What this deliberately does NOT do:
 *  - Never returns a performance number (CTR, ROAS, spend, conversions) -
 *    the Ad Library API doesn't provide them for ordinary commercial ads,
 *    and the spec explicitly forbids inventing them.
 *  - Never claims an ad performs well. The only real signals available are
 *    observed duration (first/last seen) and whether it's still running -
 *    proxies, not proof, and labelled as such everywhere this is surfaced.
 *  - Never stores or reproduces the creative body/image beyond what the
 *    API itself returns for research - no re-hosting, no claiming it as
 *    Topsqill's own content.
 */

export type AdLibraryResult = {
  pageName: string;
  headline: string | null;
  body: string | null;
  linkCaption: string | null;
  platforms: string[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  stillRunning: boolean;
  daysObserved: number | null;
  snapshotUrl: string | null;
};

export class AdLibraryError extends Error {}
export class AdLibraryNotConfiguredError extends AdLibraryError {}

type RawAd = {
  page_name?: string;
  ad_creative_link_titles?: string[];
  ad_creative_bodies?: string[];
  ad_creative_link_captions?: string[];
  publisher_platforms?: string[];
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_snapshot_url?: string;
};

export function mapAd(raw: RawAd, now = Date.now()): AdLibraryResult {
  const firstSeenAt = raw.ad_delivery_start_time ?? null;
  const lastSeenAt = raw.ad_delivery_stop_time ?? null;
  const stillRunning = !raw.ad_delivery_stop_time;
  const start = firstSeenAt ? new Date(firstSeenAt).getTime() : null;
  const end = lastSeenAt ? new Date(lastSeenAt).getTime() : now;
  const daysObserved = start != null && !Number.isNaN(start) ? Math.max(1, Math.round((end - start) / 86_400_000)) : null;
  return {
    pageName: raw.page_name ?? "Unknown advertiser",
    headline: raw.ad_creative_link_titles?.[0] ?? null,
    body: raw.ad_creative_bodies?.[0] ?? null,
    linkCaption: raw.ad_creative_link_captions?.[0] ?? null,
    platforms: raw.publisher_platforms ?? [],
    firstSeenAt, lastSeenAt, stillRunning, daysObserved,
    snapshotUrl: raw.ad_snapshot_url ?? null,
  };
}

const FIELDS = "page_name,ad_creative_link_titles,ad_creative_bodies,ad_creative_link_captions,publisher_platforms,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url";

/** One real HTTP call to Meta's public Ad Library. Never silently returns fabricated results on failure - throws instead. */
export async function searchAdLibrary(opts: {
  appId?: string; appSecret?: string; apiVersion: string;
  searchTerms: string; countries: string[]; limit: number;
}): Promise<AdLibraryResult[]> {
  if (!opts.appId || !opts.appSecret) throw new AdLibraryNotConfiguredError("Meta Ad Library isn't configured (no META_APP_ID/META_APP_SECRET) - this search can't run.");
  if (!opts.searchTerms?.trim()) throw new AdLibraryError("A search term (advertiser name, product or keyword) is needed.");

  const url = new URL(`https://graph.facebook.com/${opts.apiVersion}/ads_archive`);
  url.searchParams.set("access_token", `${opts.appId}|${opts.appSecret}`);
  url.searchParams.set("ad_type", "ALL");
  url.searchParams.set("ad_reached_countries", JSON.stringify(opts.countries));
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("limit", String(Math.min(Math.max(opts.limit, 1), 50)));
  url.searchParams.set("search_terms", opts.searchTerms.trim().slice(0, 200));

  const res = await fetch(url).catch((e) => { throw new AdLibraryError(`Couldn't reach Meta's Ad Library: ${(e as Error).message}`); });
  const json = await res.json().catch(() => ({})) as { data?: RawAd[]; error?: { message?: string; error_user_msg?: string } };
  if (!res.ok || json.error) {
    throw new AdLibraryError(`Meta Ad Library: ${json.error?.error_user_msg || json.error?.message || res.status}`.slice(0, 300));
  }
  return (json.data ?? []).map((r) => mapAd(r));
}
