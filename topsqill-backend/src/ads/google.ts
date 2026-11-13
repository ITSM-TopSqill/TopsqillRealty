/**
 * Google Search ads on Topsqill's own Google Ads account (REST API). A
 * campaign becomes: budget → Search campaign (paused) → area around the
 * property (or the city) and English → ad group → locality keywords →
 * responsive search ad pointing at the listing page. Created in one request,
 * so it either all exists or none of it does; then switched on.
 */
export type GoogleCtx = { version: string; customerId: string; loginCustomerId?: string; developerToken: string; oauth: { client_id: string; client_secret: string; refresh_token: string } };

export class GoogleAdsError extends Error {}

let tokenCache: { token: string; until: number; key: string } | null = null;
async function accessToken(ctx: GoogleCtx) {
  const key = ctx.oauth.refresh_token.slice(-12);
  if (tokenCache && tokenCache.key === key && Date.now() < tokenCache.until) return tokenCache.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: ctx.oauth.client_id, client_secret: ctx.oauth.client_secret, refresh_token: ctx.oauth.refresh_token }),
  });
  const j = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new GoogleAdsError(`Google sign-in: ${j.error_description ?? j.error ?? res.status}`);
  tokenCache = { token: j.access_token, until: Date.now() + ((j.expires_in ?? 3600) - 120) * 1000, key };
  return j.access_token;
}

async function call<T = any>(ctx: GoogleCtx, path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://googleads.googleapis.com/${ctx.version}/customers/${ctx.customerId}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await accessToken(ctx)}`, "developer-token": ctx.developerToken, "content-type": "application/json",
      ...(ctx.loginCustomerId ? { "login-customer-id": ctx.loginCustomerId } : {}),
    },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({})) as any;
  if (!res.ok) {
    const detail = j?.error?.details?.[0]?.errors?.[0]?.message ?? j?.error?.message ?? res.status;
    throw new GoogleAdsError(`Google Ads: ${detail}`.slice(0, 280));
  }
  return j as T;
}

export async function googleCheck(ctx: GoogleCtx) {
  const r = await call<{ results?: { customer?: { descriptiveName?: string; currencyCode?: string } }[] }>(ctx, "googleAds:search", { query: "SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1" });
  const c = r.results?.[0]?.customer;
  return { account: c?.descriptiveName ?? ctx.customerId, currency: c?.currencyCode ?? null };
}

export type GoogleAd = {
  name: string; finalUrl: string; dailyBudgetPaise: number;
  headlines: string[]; descriptions: string[]; keywords: string[];
  place: { lat: number | null; lng: number | null; city: string; radiusKm: number };
};

const fit = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n).trim();
const uniq = (xs: string[]) => [...new Map(xs.filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];

export async function googleLaunch(ctx: GoogleCtx, ad: GoogleAd) {
  const c = `customers/${ctx.customerId}`;
  const headlines = uniq(ad.headlines.map((h) => fit(h, 30))).slice(0, 15);
  const descriptions = uniq(ad.descriptions.map((d) => fit(d, 90))).slice(0, 4);
  if (headlines.length < 3 || descriptions.length < 2) throw new GoogleAdsError("Google Ads: needs at least 3 headlines and 2 descriptions.");

  // Where: a circle around the property, or the city when there's no map pin.
  let place: Record<string, unknown>;
  if (ad.place.lat != null && ad.place.lng != null) {
    place = { proximity: { geoPoint: { latitudeInMicroDegrees: Math.round(ad.place.lat * 1e6), longitudeInMicroDegrees: Math.round(ad.place.lng * 1e6) }, radius: ad.place.radiusKm, radiusUnits: "KILOMETERS" } };
  } else {
    const res = await fetch(`https://googleads.googleapis.com/${ctx.version}/geoTargetConstants:suggest`, {
      method: "POST",
      headers: { authorization: `Bearer ${await accessToken(ctx)}`, "developer-token": ctx.developerToken, "content-type": "application/json", ...(ctx.loginCustomerId ? { "login-customer-id": ctx.loginCustomerId } : {}) },
      body: JSON.stringify({ locale: "en", countryCode: "IN", locationNames: { names: [ad.place.city] } }),
    });
    const j = await res.json().catch(() => ({})) as { geoTargetConstantSuggestions?: { geoTargetConstant?: { resourceName: string } }[] };
    const rn = j.geoTargetConstantSuggestions?.[0]?.geoTargetConstant?.resourceName;
    place = { location: { geoTargetConstant: rn ?? "geoTargetConstants/2356" } };   // 2356 = India
  }

  const ops: Record<string, unknown>[] = [
    { campaignBudgetOperation: { create: { resourceName: `${c}/campaignBudgets/-1`, name: `${ad.name} budget ${Date.now()}`.slice(0, 250), amountMicros: String(Math.max(ad.dailyBudgetPaise, 10000) * 10_000), deliveryMethod: "STANDARD", explicitlyShared: false } } },
    { campaignOperation: { create: {
      resourceName: `${c}/campaigns/-2`, name: `${ad.name} ${Date.now()}`.slice(0, 250), status: "PAUSED", advertisingChannelType: "SEARCH",
      campaignBudget: `${c}/campaignBudgets/-1`, targetSpend: {},
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE_OR_INTEREST" },
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    } } },
    { campaignCriterionOperation: { create: { campaign: `${c}/campaigns/-2`, ...place } } },
    { campaignCriterionOperation: { create: { campaign: `${c}/campaigns/-2`, language: { languageConstant: "languageConstants/1000" } } } },
    { adGroupOperation: { create: { resourceName: `${c}/adGroups/-3`, name: "Property", campaign: `${c}/campaigns/-2`, status: "ENABLED", type: "SEARCH_STANDARD" } } },
    ...uniq(ad.keywords.map((k) => fit(k, 80).toLowerCase())).slice(0, 20).map((text) => ({
      adGroupCriterionOperation: { create: { adGroup: `${c}/adGroups/-3`, status: "ENABLED", keyword: { text, matchType: "PHRASE" } } },
    })),
    { adGroupAdOperation: { create: { adGroup: `${c}/adGroups/-3`, status: "ENABLED", ad: {
      finalUrls: [ad.finalUrl],
      responsiveSearchAd: { headlines: headlines.map((text) => ({ text })), descriptions: descriptions.map((text) => ({ text })) },
    } } } },
  ];
  const r = await call<{ mutateOperationResponses?: Record<string, { resourceName?: string }>[] }>(ctx, "googleAds:mutate", { mutateOperations: ops });
  const campaign = r.mutateOperationResponses?.map((x) => x.campaignResult?.resourceName).find(Boolean);
  const budget = r.mutateOperationResponses?.map((x) => x.campaignBudgetResult?.resourceName).find(Boolean);
  if (!campaign) throw new GoogleAdsError("Google Ads: the campaign wasn't created.");
  await googleSetStatus(ctx, campaign, true);
  return { campaignId: campaign, budgetId: budget ?? "" };
}

export async function googleSetStatus(ctx: GoogleCtx, campaignResource: string, on: boolean) {
  await call(ctx, "googleAds:mutate", { mutateOperations: [{ campaignOperation: { update: { resourceName: campaignResource, status: on ? "ENABLED" : "PAUSED" }, updateMask: "status" } }] });
}

export async function googleStats(ctx: GoogleCtx, campaignResource: string) {
  const r = await call<{ results?: { metrics?: { costMicros?: string; clicks?: string; impressions?: string; conversions?: number } }[] }>(ctx, "googleAds:search", {
    query: `SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE campaign.resource_name = '${campaignResource.replace(/'/g, "")}'`,
  });
  const m = r.results?.[0]?.metrics ?? {};
  return { spendPaise: Math.round(Number(m.costMicros ?? 0) / 10_000), clicks: Number(m.clicks ?? 0), impressions: Number(m.impressions ?? 0), leads: Math.round(Number(m.conversions ?? 0)) };
}
