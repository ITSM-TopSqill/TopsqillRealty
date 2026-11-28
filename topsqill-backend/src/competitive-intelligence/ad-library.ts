/**
 * Meta Ad Library (the public, official "approved source" named in the
 * Competitive Intelligence spec). Needs a User or System User access token
 * from someone with a role on the app (a bare app_id|app_secret token is
 * refused by `ads_archive` with an opaque "app role required" error).
 *
 * Confirmed the hard way (support ticket's worth of trial and error): Meta's
 * ads_archive only ever returns (a) ads about social issues/elections/
 * politics, worldwide, or (b) ads of any kind delivered to the UK or EU.
 * Ordinary commercial ads anywhere else - India included - are simply not
 * in this API's scope, no matter the credentials. `searchAdLibrary` checks
 * the requested countries against that real list and refuses up front with
 * an honest message, rather than making a call Meta will reject anyway.
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
export class AdLibraryUnsupportedMarketError extends AdLibraryError {}

/** The only countries ads_archive serves ordinary commercial ads for: the UK plus EU/EEA member states. */
export const AD_LIBRARY_COMMERCIAL_COUNTRIES = new Set([
  "GB", "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
]);

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
  appId?: string; appSecret?: string; accessToken?: string; apiVersion: string;
  searchTerms: string; countries: string[]; limit: number;
}): Promise<AdLibraryResult[]> {
  const token = opts.accessToken || (opts.appId && opts.appSecret ? `${opts.appId}|${opts.appSecret}` : null);
  if (!token) throw new AdLibraryNotConfiguredError("Meta Ad Library isn't configured (no META_ACCESS_TOKEN, or META_APP_ID/META_APP_SECRET) - this search can't run.");
  if (!opts.searchTerms?.trim()) throw new AdLibraryError("A search term (advertiser name, product or keyword) is needed.");
  if (!opts.countries.some((c) => AD_LIBRARY_COMMERCIAL_COUNTRIES.has(c))) {
    throw new AdLibraryUnsupportedMarketError(
      "Meta's Ad Library API only covers ordinary commercial ads delivered to the UK or EU (plus ads about politics or social issues, worldwide) - it doesn't cover this market. Enter ads for this competitor by hand instead.",
    );
  }

  const url = new URL(`https://graph.facebook.com/${opts.apiVersion}/ads_archive`);
  url.searchParams.set("access_token", token);
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
