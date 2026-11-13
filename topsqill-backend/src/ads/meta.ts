/**
 * Meta (Facebook and Instagram) ads on Topsqill's own ad account, through the
 * Marketing API with a system user token. A campaign becomes:
 *   lead form (on Topsqill's Page) → campaign → ad set (area, budget, dates)
 *   → creative (photos or video, our ad text) → ad.
 * Everything is created paused and switched on only once all of it exists, so
 * a half-made campaign never spends.
 */
export type MetaCtx = { token: string; version: string; adAccountId: string; pageId: string; instagramUserId?: string; housing: boolean };

export class MetaError extends Error {}

async function graph<T = any>(ctx: Pick<MetaCtx, "token" | "version">, path: string, init: { method?: "GET" | "POST"; body?: Record<string, unknown>; query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${ctx.version}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${ctx.token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({})) as { error?: { message?: string; error_user_msg?: string; error_user_title?: string } } & T;
  if (!res.ok || json.error) {
    const e = json.error;
    throw new MetaError(`Meta: ${e?.error_user_msg || e?.error_user_title || e?.message || res.status}`.slice(0, 280));
  }
  return json;
}

/** Who the token belongs to and whether it can see the ad account and Page. */
export async function metaCheck(ctx: MetaCtx) {
  const me = await graph<{ id: string; name?: string }>(ctx, "me", { query: { fields: "id,name" } });
  const acct = ctx.adAccountId ? await graph<{ name?: string; account_status?: number; currency?: string }>(ctx, `act_${ctx.adAccountId}`, { query: { fields: "name,account_status,currency" } }) : null;
  const page = ctx.pageId ? await graph<{ name?: string }>(ctx, ctx.pageId, { query: { fields: "name" } }) : null;
  return { user: me.name ?? me.id, adAccount: acct?.name ?? null, currency: acct?.currency ?? null, active: acct?.account_status === 1, page: page?.name ?? null };
}

async function pageToken(ctx: MetaCtx) {
  const p = await graph<{ access_token?: string }>(ctx, ctx.pageId, { query: { fields: "access_token" } });
  if (!p.access_token) throw new MetaError("Meta: the token can't manage Topsqill's Page (needs pages_manage_ads).");
  return p.access_token;
}

/** Meta's id for a city, when the listing has no map pin. */
async function cityKey(ctx: MetaCtx, city: string) {
  const r = await graph<{ data?: { key: string; name: string; country_code: string }[] }>(ctx, "search", {
    query: { type: "adgeolocation", location_types: JSON.stringify(["city"]), q: city, country_code: "IN", limit: "1" },
  });
  return r.data?.[0]?.key ?? null;
}

export type MetaAd = {
  name: string;
  link: string;                     // the listing page, with our tracking
  privacyUrl: string;
  headline: string; primaryText: string; description: string;
  pictures: string[];               // 1 = single image ad, 2+ = carousel
  video?: { url: string; thumbnail: string } | null;
  place: { lat: number | null; lng: number | null; city: string; radiusKm: number };
  dailyBudgetPaise: number;
  endsAt: Date;
  purpose: "sale" | "rent";
};

/** Creates the whole campaign, switched on. Returns Meta's ids for everything made. */
export async function metaLaunch(ctx: MetaCtx, ad: MetaAd, onStep?: (ids: Record<string, string>) => Promise<void>) {
  const ids: Record<string, string> = {};
  const save = async () => { await onStep?.({ ...ids }); };
  const act = `act_${ctx.adAccountId}`;

  // 1. Lead form on Topsqill's Page: name and phone are filled in from the person's profile.
  const pToken = await pageToken(ctx);
  const form = await graph<{ id: string }>({ token: pToken, version: ctx.version }, `${ctx.pageId}/leadgen_forms`, { body: {
    name: `${ad.name} · ${new Date().toISOString().slice(0, 10)}`.slice(0, 100),
    locale: "EN_US",
    questions: [
      { type: "FULL_NAME" }, { type: "PHONE" }, { type: "EMAIL" },
      { type: "CUSTOM", key: "timeline", label: ad.purpose === "rent" ? "When do you want to move in?" : "When are you planning to buy?",
        options: [{ key: "now", value: "Within a month" }, { key: "3m", value: "In 1 to 3 months" }, { key: "later", value: "Later, just exploring" }] },
    ],
    privacy_policy: { url: ad.privacyUrl, link_text: "Privacy policy" },
    follow_up_action_url: ad.link,
    thank_you_page: { title: "Thanks! We'll call you shortly.", body: "The property expert will contact you on the number you shared.", button_type: "VIEW_WEBSITE", button_text: "See the property", website_url: ad.link },
  } });
  ids.formId = form.id; await save();

  // 2. Campaign (lead generation). Property ads may need Meta's housing category; it's a setting.
  const campaign = await graph<{ id: string }>(ctx, `${act}/campaigns`, { body: {
    name: ad.name.slice(0, 100), objective: "OUTCOME_LEADS", status: "PAUSED", buying_type: "AUCTION",
    special_ad_categories: ctx.housing ? ["HOUSING"] : [],
    ...(ctx.housing ? { special_ad_category_country: ["IN"] } : {}),
    is_adset_budget_sharing_enabled: false,
  } });
  ids.campaignId = campaign.id; await save();

  // 3. Ad set: where (around the property, or the city), how much a day, until when.
  const radius = ctx.housing ? Math.max(ad.place.radiusKm, 25) : ad.place.radiusKm;   // housing ads need a wider area
  let geo: Record<string, unknown>;
  if (ad.place.lat != null && ad.place.lng != null) {
    geo = { custom_locations: [{ latitude: ad.place.lat, longitude: ad.place.lng, radius, distance_unit: "kilometer" }] };
  } else {
    const key = await cityKey(ctx, ad.place.city);
    geo = key ? { cities: [{ key, radius: Math.min(radius, 80), distance_unit: "kilometer" }] } : { countries: ["IN"] };
  }
  const adset = await graph<{ id: string }>(ctx, `${act}/adsets`, { body: {
    name: `${ad.name} · audience`.slice(0, 100), campaign_id: campaign.id, status: "PAUSED",
    daily_budget: Math.max(ad.dailyBudgetPaise, 10000), billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP", destination_type: "ON_AD", promoted_object: { page_id: ctx.pageId },
    start_time: new Date().toISOString(), end_time: ad.endsAt.toISOString(),
    targeting: {
      geo_locations: geo,
      ...(ctx.housing ? {} : { age_min: 25 }),
      publisher_platforms: ["facebook", "instagram"],
      targeting_automation: { advantage_audience: 1 },
    },
  } });
  ids.adsetId = adset.id; await save();

  // 4. Creative: video, carousel, or one photo, with our text and the lead form.
  const cta = { type: "LEARN_MORE", value: { lead_gen_form_id: form.id } };
  const ig = ctx.instagramUserId ? { instagram_user_id: ctx.instagramUserId } : {};
  let spec: Record<string, unknown>;
  if (ad.video) {
    const v = await graph<{ id: string }>(ctx, `${act}/advideos`, { body: { file_url: ad.video.url, name: ad.name.slice(0, 80) } });
    ids.videoId = v.id;
    spec = { page_id: ctx.pageId, ...ig, video_data: { video_id: v.id, image_url: ad.video.thumbnail, message: ad.primaryText, title: ad.headline, link_description: ad.description, call_to_action: cta } };
  } else if (ad.pictures.length > 1) {
    spec = { page_id: ctx.pageId, ...ig, link_data: {
      message: ad.primaryText, link: ad.link, call_to_action: cta, multi_share_end_card: false,
      child_attachments: ad.pictures.slice(0, 10).map((p, i) => ({ link: ad.link, picture: p, name: i === 0 ? ad.headline : ad.headline.slice(0, 40), description: ad.description, call_to_action: cta })),
    } };
  } else {
    spec = { page_id: ctx.pageId, ...ig, link_data: { message: ad.primaryText, link: ad.link, picture: ad.pictures[0], name: ad.headline, description: ad.description, call_to_action: cta } };
  }
  const creative = await graph<{ id: string }>(ctx, `${act}/adcreatives`, { body: { name: `${ad.name} · creative`.slice(0, 100), object_story_spec: spec } });
  ids.creativeId = creative.id; await save();

  // 5. The ad, then switch everything on.
  const created = await graph<{ id: string }>(ctx, `${act}/ads`, { body: { name: `${ad.name} · ad`.slice(0, 100), adset_id: adset.id, creative: { creative_id: creative.id }, status: "PAUSED" } });
  ids.adId = created.id; await save();
  for (const id of [created.id, adset.id, campaign.id]) await graph(ctx, id, { body: { status: "ACTIVE" } });
  return ids;
}

/** Pause, resume or stop. A stopped campaign is paused (Meta keeps its results). */
export async function metaSetStatus(ctx: Pick<MetaCtx, "token" | "version">, campaignId: string, on: boolean) {
  await graph(ctx, campaignId, { body: { status: on ? "ACTIVE" : "PAUSED" } });
}

/** Results so far, all time. Spend comes back in rupees as text. */
export async function metaStats(ctx: Pick<MetaCtx, "token" | "version">, campaignId: string) {
  const r = await graph<{ data?: { spend?: string; impressions?: string; clicks?: string; actions?: { action_type: string; value: string }[] }[] }>(ctx, `${campaignId}/insights`, {
    query: { fields: "spend,impressions,clicks,actions", date_preset: "maximum" },
  });
  const row = r.data?.[0] ?? {};
  const leads = row.actions?.find((a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped")?.value;
  return { spendPaise: Math.round(Number(row.spend ?? 0) * 100), impressions: Number(row.impressions ?? 0), clicks: Number(row.clicks ?? 0), leads: Number(leads ?? 0) };
}

/** A lead someone submitted on one of our forms (from the Page webhook). */
export async function metaLead(ctx: Pick<MetaCtx, "token" | "version">, leadgenId: string) {
  const r = await graph<{ id: string; created_time: string; form_id?: string; campaign_id?: string; ad_id?: string; field_data?: { name: string; values: string[] }[] }>(ctx, leadgenId, {
    query: { fields: "id,created_time,form_id,campaign_id,ad_id,field_data" },
  });
  const f = Object.fromEntries((r.field_data ?? []).map((x) => [x.name.toLowerCase(), x.values?.[0] ?? ""]));
  return { id: r.id, formId: r.form_id ?? null, campaignId: r.campaign_id ?? null, name: f.full_name || f.name || "", phone: f.phone_number || f.phone || "", email: f.email || "", timeline: f.timeline || "" };
}
