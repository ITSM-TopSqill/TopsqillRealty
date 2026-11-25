import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { campaigns, listings, media, requirements, users, campaignRecommendations } from "../db/schema";
import { ClaudeService } from "../ai/claude.service";
import { SearchService } from "../search/search.service";
import { GeoService } from "../geo/geo.service";
import { buildPlan, forecast, segmentOf, type Plan } from "./planner";
import { buildRecommendations, forecastRemaining, evaluateForecastAccuracy, type CampaignInsightInput, type RecommendationCandidate } from "./insights";
import { pincodesFor, HNI_FEEDERS } from "./pincodes";
import { newId } from "../common/ids";
import { speakMp3 } from "../common/tts";
import { writePublic, publicBase } from "../media/storage";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { queryOn } from "../ads/db";
import { loadAds } from "../ads/settings";

export type PodcastLine = { host: "Priya" | "Arjun"; line: string };
export type Podcast = { script: PodcastLine[]; audioUrl: string | null; seconds: number; source: "claude" | "rules"; at: string };
type Place = { label?: string; lat: number; lng: number; radiusKm?: number };

/** Keeps only well-formed points, capped and within a sane radius - never trusts client input straight into targeting. */
function sanitizePlaces(arr: Place[] | undefined): { label: string; lat: number; lng: number; radiusKm: number }[] | undefined {
  if (!arr?.length) return undefined;
  const out = arr
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)
    .slice(0, 8)
    .map((p) => ({ label: (p.label ?? "").trim().slice(0, 80) || "Area", lat: p.lat, lng: p.lng, radiusKm: Math.min(Math.max(Number(p.radiusKm) || 5, 1), 50) }));
  return out.length ? out : undefined;
}

@Injectable()
export class CampaignsService {
  private readonly q;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    @Inject("PG_POOLS") pools: { writePool: Pool },
    private readonly claude: ClaudeService,
    private readonly search: SearchService,
    private readonly geo: GeoService,
  ) {
    this.q = queryOn(pools.writePool);
  }

  /** Builds the whole campaign: targeting, channels, creatives and a forecast. */
  async create(userId: string, input: {
    listingId?: string; goal?: string; budgetInr: number; days?: number; notes?: string;
    mediaIds?: string[]; headline?: string; text?: string; city?: string; link?: string;
    extraPlaces?: Place[]; excludePlaces?: Place[];
  }) {
    const adsSettings = await loadAds(this.q);
    if (input.budgetInr < adsSettings.minCampaignInr) throw new BadRequestException(`The minimum campaign budget is ₹${adsSettings.minCampaignInr.toLocaleString("en-IN")}.`);

    if (!input.listingId) return this.createFromCreative(userId, input);

    const [listing] = await this.read.select().from(listings).where(eq(listings.id, input.listingId)).limit(1);
    if (!listing) throw new NotFoundException("That listing could not be found.");
    if (listing.ownerId !== userId) throw new ForbiddenException("You can only promote your own listings.");

    const demand = await this.demandFor(listing.city, listing.locality, listing.purpose);
    const stats = await this.search.localityStats(listing.locality, listing.city);
    const avgRate = Number((stats as Record<string, unknown> | null)?.avgRatePerSqft ?? 0) || demand.avgRate;

    const plan = buildPlan({
      purpose: listing.purpose, priceInr: listing.priceInr ?? 0, bhk: listing.bhk, kind: listing.kind,
      city: listing.city, locality: listing.locality, possession: listing.possession,
      amenities: listing.amenities, goal: input.goal ?? "Qualified buyers",
      demand: { ...demand, avgRate },
      pincodesFor,
    });
    // High-income feeder pincodes for premium homes.
    if (plan.personas.some((p) => p.name.startsWith("HNI"))) {
      for (const [pin, area] of HNI_FEEDERS[listing.city] ?? []) {
        if (!plan.pincodes.some((p) => p.pin === pin)) {
          plan.pincodes.push({ pin, area, tier: "HNI", reason: "Premium pincode with high-income households" });
        }
      }
    }
    // The plan's own radius is just for display; the real radius sent to Meta
    // and Google is whichever admin setting is larger (Housing ads need 25km+).
    plan.radiusKm = Math.max(adsSettings.meta.radiusKm, adsSettings.google.radiusKm) || plan.radiusKm;

    const segment = segmentOf(listing.purpose, listing.priceInr ?? 0);
    const fc = forecast(plan, input.budgetInr, segment);
    const creatives = await this.creatives(userId, listing, plan, input.notes);

    const id = newId();
    const [row] = await this.db.insert(campaigns).values({
      id, ownerId: userId, listingId: listing.id,
      name: `${listing.title} | ${input.goal ?? "Qualified buyers"}`,
      goal: input.goal ?? "Qualified buyers", budgetInr: input.budgetInr, days: input.days ?? 15,
      plan: plan as never, creatives: creatives as never, forecast: fc as never,
      extraPlaces: sanitizePlaces(input.extraPlaces), excludePlaces: sanitizePlaces(input.excludePlaces),
    }).returning();
    return row;
  }

  /**
   * A campaign with no listing: an uploaded photo ("From Creative") or video
   * ("From Video") the advertiser writes its own headline and text for, with
   * a city to target instead of a listing's address. No AI demand/plan
   * pipeline runs here - there's no listing to read it from.
   */
  private async createFromCreative(userId: string, input: { goal?: string; budgetInr: number; days?: number; notes?: string; mediaIds?: string[]; headline?: string; text?: string; city?: string; link?: string; extraPlaces?: Place[]; excludePlaces?: Place[] }) {
    const mediaIds = (input.mediaIds ?? []).slice(0, 6);
    if (!mediaIds.length) throw new BadRequestException("Add at least one photo or a video.");
    const headline = input.headline?.trim().slice(0, 60);
    if (!headline) throw new BadRequestException("Give the ad a headline.");
    const city = input.city?.trim().slice(0, 80);
    if (!city) throw new BadRequestException("Choose a city to target.");

    const rows = await this.read.select({ id: media.id, ownerId: media.ownerId, status: media.status }).from(media).where(inArray(media.id, mediaIds));
    if (rows.length !== mediaIds.length || rows.some((m) => m.ownerId !== userId)) throw new ForbiddenException("One of those files isn't yours.");

    const text = input.text?.trim().slice(0, 400) || headline;
    const creatives = {
      headlines: [headline],
      primaryTexts: [input.notes?.trim().slice(0, 400) || text],
    };

    const id = newId();
    const [row] = await this.db.insert(campaigns).values({
      id, ownerId: userId, listingId: null,
      name: headline, goal: input.goal ?? "Qualified buyers", budgetInr: input.budgetInr, days: input.days ?? 15,
      mediaIds, city, link: input.link?.trim().slice(0, 300) || null,
      creatives: creatives as never,
      extraPlaces: sanitizePlaces(input.extraPlaces), excludePlaces: sanitizePlaces(input.excludePlaces),
    }).returning();
    return row;
  }

  /**
   * Phase 2 of the AI campaign manager: describe the buyer in plain words and
   * get back a reviewable starting point - a goal, a budget tier, and a
   * handful of real, geocoded localities with the reasoning behind each one.
   * Nothing is created here; the advertiser accepts, edits or drops each area
   * before it ever reaches `create()`.
   */
  async suggestAudience(userId: string, input: { description: string; listingId?: string; city?: string }) {
    const description = input.description?.trim().slice(0, 400);
    if (!description) throw new BadRequestException("Describe who you're trying to reach.");

    let city = input.city?.trim().slice(0, 80) || "";
    let listingCtx = "";
    if (input.listingId) {
      const [listing] = await this.read.select().from(listings).where(eq(listings.id, input.listingId)).limit(1);
      if (listing && listing.ownerId === userId) {
        city = city || listing.city;
        listingCtx = `Listing: ${JSON.stringify({ title: listing.title, purpose: listing.purpose, bhk: listing.bhk, price: listing.priceInr, city: listing.city, locality: listing.locality })}`;
      }
    }

    const fallback = () => ({
      goal: "Qualified buyers", budgetInr: 30000,
      areas: city ? [{ locality: city, reason: "The campaign's own city." }] : [],
      rationale: "AI suggestions aren't available right now, so this just targets the campaign's own city.",
    });
    const prompt = `A real estate advertiser in India describes their ideal buyer. Suggest a starting campaign: a goal, a daily-spend-appropriate total budget in INR, and up to 5 real localities (by name, in or near ${city || "the advertiser's city"}) worth targeting, each with a one-line reason grounded in the description (never invent income or financial status from a locality - treat it only as a market signal). Return ONLY JSON: {"goal":"one of Qualified buyers, Site visits, Brand awareness, Tenants","budgetInr":number,"areas":[{"locality":"name, city","reason":"max 100 chars"}],"rationale":"max 200 chars, explains the overall strategy"}.
${listingCtx}
Buyer description: ${description}`;
    const { data, source } = await this.claude.json<{ goal: string; budgetInr: number; areas: { locality: string; reason: string }[]; rationale: string }>(
      prompt, fallback, { userId, feature: "campaign.audience", maxTokens: 900 },
    );
    const areas = await this.geocodeAreas(userId, (data.areas ?? []).slice(0, 5), city);
    // So a listing-less campaign's "City to target" field isn't left empty when the advertiser typed none.
    const resolvedCity = city || areas.find((a) => a.city)?.city || "";
    return { goal: data.goal || "Qualified buyers", budgetInr: Math.max(Number(data.budgetInr) || 0, 5000), areas, rationale: data.rationale ?? "", city: resolvedCity, source };
  }

  /** Turns the AI's named localities into real points: only places Nominatim can actually find make it back to the user. */
  private async geocodeAreas(userId: string, areas: { locality: string; reason: string }[], city: string) {
    const out: { label: string; lat: number; lng: number; radiusKm: number; reason: string; city: string | null }[] = [];
    for (const a of areas) {
      if (!a?.locality) continue;
      const { items } = await this.geo.search(userId, a.locality, city || undefined).catch(() => ({ items: [] }));
      if (items[0]) out.push({ label: items[0].label, lat: items[0].lat, lng: items[0].lng, radiusKm: 5, reason: a.reason?.slice(0, 100) ?? "", city: items[0].city });
    }
    return out;
  }

  /** Adds more photos/video to a listing-less campaign still in draft (before it's sent for review). */
  async addMedia(userId: string, id: string, mediaIds: string[]) {
    const c = await this.get(userId, id);
    if (c.status !== "draft" && c.status !== "rejected") throw new BadRequestException("You can only add media before sending the campaign for review.");
    const rows = await this.read.select({ id: media.id, ownerId: media.ownerId }).from(media).where(inArray(media.id, mediaIds));
    if (rows.length !== mediaIds.length || rows.some((m) => m.ownerId !== userId)) throw new ForbiddenException("One of those files isn't yours.");
    const next = [...new Set([...(c.mediaIds ?? []), ...mediaIds])].slice(0, 10);
    const [row] = await this.db.update(campaigns).set({ mediaIds: next, updatedAt: new Date() }).where(eq(campaigns.id, id)).returning();
    return row;
  }

  /** Real demand on Topsqill.ai, used to choose target areas rather than guessing. */
  private async demandFor(city: string, locality: string, purpose: "sale" | "rent") {
    const here = await this.read.select({ n: sql<number>`count(*)::int` }).from(requirements)
      .where(and(eq(requirements.city, city), eq(requirements.purpose, purpose), eq(requirements.status, "active"),
        sql`${requirements.localities} @> ${JSON.stringify([locality])}::jsonb`));
    const top = await this.read.execute(sql`
      select l.value as locality, count(*)::int as buyers
      from requirements r, jsonb_array_elements_text(r.localities) l
      where r.city = ${city} and r.purpose = ${purpose} and r.status = 'active' and l.value <> ${locality}
      group by l.value order by count(*) desc limit 3`);
    const rows = (Array.isArray(top) ? top : (top as { rows: unknown[] }).rows) as { locality: string; buyers: number }[];
    return { buyersHere: here[0]?.n ?? 0, topLocalities: rows, avgRate: 7000 };
  }

  private async creatives(userId: string, l: typeof listings.$inferSelect, plan: Plan, notes?: string) {
    const bhk = l.bhk ? `${l.bhk} BHK` : "";
    const amenities = (l.amenities ?? []).slice(0, 3);
    // Built from parts that may be missing (facing, possession, amenities, area), so a
    // listing with few details filled in still reads as a sentence, never "with . 0 sq ft".
    const descBits = [[l.facing, l.possession?.toLowerCase()].filter(Boolean).join(" "), amenities.length ? `with ${amenities.join(", ").toLowerCase()}` : ""].filter(Boolean).join(", ");
    const areaBit = l.areaSqft ? `${Number(l.areaSqft).toLocaleString("en-IN")} sq ft at ` : "";
    const areaSub = l.areaSqft ? `${Number(l.areaSqft).toLocaleString("en-IN")} sq ft` : "Spacious layout";
    const fallback = () => ({
      headlines: [`${bhk} in ${l.locality} at ${inr(l.priceInr ?? 0)}`.trim(), "Your family’s next home is here", `${l.possession ?? "Ready"}: ${l.locality}`],
      primaryTexts: [
        `🏡 ${l.title}.${descBits ? ` ${descBits}.` : ""} ${areaBit}${inr(l.priceInr ?? 0)}. Tap to book a site visit this weekend.`.replace(/\s+/g, " "),
        `Looking in ${l.locality}? This ${bhk} has everything on your list. Get the floor plan and price sheet in one tap.`,
      ],
      hinglish: `${l.locality} mein apna ${bhk} ghar, ${inr(l.priceInr ?? 0)} mein 🏡 Site visit is weekend book karein!`,
      carousel: [
        { title: bhk || l.kind, sub: areaSub },
        { title: "Living spaces", sub: l.furnishing ?? "Well-kept and airy" },
        { title: "Amenities", sub: amenities.join(", ") || "Clubhouse and more" },
        { title: "Location", sub: `${l.locality}, ${l.city}` },
        { title: inr(l.priceInr ?? 0), sub: "Book a site visit" },
      ],
      reel: [
        { caption: `Found it: ${bhk} in ${l.locality}`, sub: l.title },
        { caption: "Light-filled rooms", sub: l.furnishing ?? "" },
        { caption: amenities[0] ?? "Great amenities", sub: amenities.slice(1).join(" | ") },
        { caption: `Close to everything in ${l.city}`, sub: "Schools, hospitals, metro" },
        { caption: inr(l.priceInr ?? 0), sub: "Book your site visit today" },
      ],
      googleAd: {
        headlines: [`${bhk} in ${l.locality}`.trim(), `${l.possession ?? "Ready to move"} | ${inr(l.priceInr ?? 0)}`, "Verified listing, clear title", "Book a site visit today"],
        descriptions: [`${bhk} in ${l.locality}, ${l.city}.${amenities.length ? ` ${amenities.slice(0, 2).join(", ")}.` : ""} Get the price sheet now.`, "Talk to a verified expert. Free site visit and home loan help."],
      },
      whatsappTemplate: `Hi {{1}}, thanks for your interest in ${l.title} (${inr(l.priceInr ?? 0)}). Here is the brochure and floor plan 📄 Would Saturday or Sunday suit you for a site visit?`,
    });
    if (!this.claude.available) return fallback();
    const prompt = `Write ad creatives for an Indian real estate campaign. Return ONLY JSON {"headlines":[3 strings max 40 chars],"primaryTexts":[2 strings max 280 chars with 1-2 emojis],"hinglish":"max 120 chars","carousel":[5 {"title" max 24 chars,"sub" max 40 chars}],"reel":[5 {"caption" max 45 chars,"sub" max 40 chars}],"googleAd":{"headlines":[4 max 30 chars],"descriptions":[2 max 90 chars]},"whatsappTemplate":"uses {{1}} for the name"}.
Never promise returns. Audience: ${plan.personas.map((p) => p.name).join(", ")}. ${notes ? `Advertiser note: ${notes}. ` : ""}
Listing: ${JSON.stringify({ title: l.title, price: l.priceInr, bhk: l.bhk, area: l.areaSqft, city: l.city, locality: l.locality, possession: l.possession, furnishing: l.furnishing, facing: l.facing, amenities: l.amenities })}`;
    const { data } = await this.claude.json(prompt, fallback, { userId, feature: "campaign.creatives", maxTokens: 1800 });
    return data;
  }

  /** Saves the advertiser's edits to the ad text (from the live preview in the studio). */
  async updateCreatives(userId: string, id: string, patch: { headlines?: string[]; primaryTexts?: string[]; cta?: string; googleHeadlines?: string[]; googleDescriptions?: string[] }) {
    const c = await this.get(userId, id);
    const cr = { ...(c.creatives ?? {}) } as Record<string, any>;
    const clean = (xs: string[] | undefined, n: number, len: number) => xs?.map((x) => String(x).trim().slice(0, len)).filter(Boolean).slice(0, n);
    if (patch.headlines) cr.headlines = clean(patch.headlines, 3, 60);
    if (patch.primaryTexts) cr.primaryTexts = clean(patch.primaryTexts, 2, 400);
    if (patch.cta !== undefined) cr.cta = String(patch.cta).trim().slice(0, 30) || null;
    if (patch.googleHeadlines || patch.googleDescriptions) {
      cr.googleAd = {
        headlines: clean(patch.googleHeadlines, 4, 30) ?? cr.googleAd?.headlines ?? [],
        descriptions: clean(patch.googleDescriptions, 2, 90) ?? cr.googleAd?.descriptions ?? [],
      };
    }
    const [row] = await this.db.update(campaigns).set({ creatives: cr, updatedAt: new Date() }).where(eq(campaigns.id, id)).returning();
    return row;
  }

  /**
   * A 60 to 90 second audio "podcast" ad about the campaign's home: two hosts
   * (Priya and Arjun) chat about it in Indian English. Written by AI from the
   * listing's facts (or by rules), spoken by two Indian English voices, and
   * saved as one MP3 the advertiser can play and download. Without
   * Text-to-Speech, only the script is returned and the website reads it aloud.
   */
  async podcast(userId: string, id: string, regenerate = false): Promise<Podcast> {
    const c = await this.get(userId, id);
    const existing = (c.creatives as Record<string, any> | null)?.podcast as Podcast | undefined;
    if (existing && !regenerate) return existing;
    if (!c.listingId) throw new BadRequestException("This campaign has no listing to talk about.");
    const [l] = await this.read.select().from(listings).where(eq(listings.id, c.listingId)).limit(1);
    if (!l) throw new NotFoundException("The campaign's listing is no longer available.");

    const bhk = l.bhk ? `${l.bhk} BHK` : l.kind.toLowerCase();
    const price = inr(l.priceInr ?? 0) + (l.purpose === "rent" ? " a month" : "");
    const amen = (l.amenities ?? []).slice(0, 4);
    const fallback = (): { script: PodcastLine[] } => ({ script: [
      { host: "Priya", line: `Hello and welcome to Home Hunt on Topsqill! I'm Priya.` },
      { host: "Arjun", line: `And I'm Arjun. Today we're looking at a ${bhk} in ${l.locality}, ${l.city}.` },
      { host: "Priya", line: `It's ${l.areaSqft ? `${l.areaSqft.toLocaleString("en-IN")} square feet` : "a generous size"}, and it's ${l.possession?.toLowerCase() ?? "ready to move"}.` },
      { host: "Arjun", line: amen.length ? `The society has ${amen.join(", ").toLowerCase()}. That's a big plus for families.` : `It's in a well-connected part of ${l.city}, close to daily needs.` },
      { host: "Priya", line: l.facing ? `And it's ${l.facing.toLowerCase()}, which a lot of buyers look for.` : `The layout makes good use of every room.` },
      { host: "Arjun", line: `So what's the price?` },
      { host: "Priya", line: `It's listed at ${price}.` },
      { host: "Arjun", line: `If ${l.locality} is on your list, book a site visit this weekend.` },
      { host: "Priya", line: `Just tap the link and message the seller on Topsqill. Happy house hunting!` },
    ] });
    const prompt = `Write a 60 to 90 second audio ad, as a friendly chat between two Indian podcast hosts, Priya and Arjun, about this home for sale or rent. Natural Indian English, warm and real, not salesy; 8 to 12 short lines in all, alternating hosts, each line at most 25 words. Use ONLY these facts; never invent amenities, distances, views, offers or returns. End with a clear call to book a site visit on Topsqill. Prices in Indian style (₹1.2 Cr, ₹85 L). Never mention any other website.
Facts: ${JSON.stringify({ title: l.title, purpose: l.purpose, kind: l.kind, bhk: l.bhk, areaSqft: l.areaSqft, price, city: l.city, locality: l.locality, possession: l.possession, furnishing: l.furnishing, facing: l.facing, amenities: amen, highlights: (l.usps ?? []).slice(0, 3) })}
Reply with JSON only: {"script":[{"host":"Priya","line":"..."},{"host":"Arjun","line":"..."}]}`;
    const { data, source } = await this.claude.json<{ script: PodcastLine[] }>(prompt, fallback, { userId, feature: "campaign.podcast", maxTokens: 1500 });
    let script = (Array.isArray(data.script) ? data.script : []).map((x) => ({ host: x?.host === "Arjun" ? "Arjun" as const : "Priya" as const, line: String(x?.line ?? "").trim().slice(0, 240) })).filter((x) => x.line).slice(0, 14);
    if (script.length < 4) script = fallback().script;

    // Each line in its host's voice, joined into one MP3 (MP3 frames can simply follow each other).
    let audioUrl: string | null = null;
    const parts: Buffer[] = [];
    for (const x of script) {
      const mp3 = await speakMp3(x.line, x.host === "Priya" ? "female" : "male");
      if (!mp3) { parts.length = 0; break; }
      parts.push(mp3);
    }
    if (parts.length) {
      const audio = Buffer.concat(parts);
      const path = `public/podcast/${c.id}/${createHash("sha1").update(audio).digest("hex").slice(0, 16)}.mp3`;
      await writePublic(path, audio, "audio/mpeg");
      audioUrl = `${publicBase()}/${path}`;
    }
    const words = script.reduce((n, x) => n + x.line.split(/\s+/).length, 0);
    const podcast: Podcast = { script, audioUrl, seconds: Math.round(words / 2.5), source: source === "claude" && script !== fallback().script ? "claude" : source, at: new Date().toISOString() };
    await this.db.update(campaigns).set({ creatives: { ...(c.creatives ?? {}), podcast }, updatedAt: new Date() }).where(eq(campaigns.id, id));
    return podcast;
  }

  async list(userId: string) {
    const rows = await this.read.select().from(campaigns).where(eq(campaigns.ownerId, userId)).orderBy(desc(campaigns.createdAt)).limit(50);
    return { items: rows };
  }

  async get(userId: string, id: string) {
    const [row] = await this.read.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    if (!row || row.ownerId !== userId) throw new NotFoundException("That campaign could not be found.");
    return row;
  }

  /* --------------------------- Phase 5: AI insights -------------------------- */

  /** Alerts, suggestions and a forecast built from this campaign's real numbers. */
  async insights(userId: string, id: string) {
    const c = await this.get(userId, id);

    const leadRows = await this.rows<{ city: string | null; locality: string | null; qualified: boolean; source: string; createdAt: string }>(sql`
      select city, locality, qualified, source, created_at as "createdAt" from leads where campaign_id = ${id} order by created_at asc`);
    const deliveryRows = await this.rows<{ platform: string; spendPaise: number }>(sql`
      select platform, spend_paise as "spendPaise" from campaign_deliveries where campaign_id = ${id} and status in ('live','paused')`);

    const platforms = deliveryRows.map((d) => {
      const own = leadRows.filter((r) => r.source === d.platform);
      return { platform: d.platform as "meta" | "google", spendPaise: Number(d.spendPaise), qualified: own.filter((r) => r.qualified).length, leads: own.length };
    });

    const localityMap = new Map<string, { leads: number; qualified: number }>();
    for (const r of leadRows) {
      const label = r.locality || r.city;
      if (!label) continue;
      const cur = localityMap.get(label) ?? { leads: 0, qualified: 0 };
      cur.leads++; if (r.qualified) cur.qualified++;
      localityMap.set(label, cur);
    }
    const localities = [...localityMap.entries()].map(([label, v]) => ({ label, ...v }));

    let earlyQualifiedRate: number | null = null, recentQualifiedRate: number | null = null;
    if (leadRows.length >= 6) {
      const mid = Math.floor(leadRows.length / 2);
      const early = leadRows.slice(0, mid), recent = leadRows.slice(mid);
      earlyQualifiedRate = early.filter((r) => r.qualified).length / early.length;
      recentQualifiedRate = recent.filter((r) => r.qualified).length / recent.length;
    }

    const elapsedDays = c.launchedAt ? Math.floor(Math.max(Date.now() - new Date(c.launchedAt).getTime(), 0) / 86_400_000) : null;

    const otherRows = await this.rows<{ spendInr: number; qualifiedCount: number }>(sql`
      select spend_inr as "spendInr", qualified_count as "qualifiedCount" from campaigns
      where owner_id = ${userId} and id <> ${id} and qualified_count > 0`);
    const ownerAvgCostPerQualifiedLeadInr = otherRows.length >= 2
      ? Math.round(otherRows.reduce((s, r) => s + Number(r.spendInr) / Number(r.qualifiedCount), 0) / otherRows.length)
      : null;

    const input: CampaignInsightInput = {
      status: c.status, budgetInr: Number(c.budgetInr), days: Number(c.days), elapsedDays,
      spendInr: Number(c.spendInr), leadsCount: Number(c.leadsCount), qualifiedCount: Number(c.qualifiedCount),
      forecastCostPerQualifiedLeadInr: (c.forecast as Record<string, number> | null)?.costPerQualifiedLead ?? null,
      platforms, localities, earlyQualifiedRate, recentQualifiedRate,
      clicks: Number(c.clicksCount), impressions: Number(c.impressionsCount),
      ownerAvgCostPerQualifiedLeadInr,
    };

    const recommendations = await this.saveRecommendations(userId, id, buildRecommendations(input));
    return { metrics: input, forecast: forecastRemaining(input), recommendations };
  }

  /**
   * Inserts only the recommendations that aren't already pending for this
   * campaign, so refreshing the page never duplicates them. Also marks any
   * previously-pending recommendation "stale" once its own category no
   * longer appears among the fresh candidates - the situation that raised
   * it has changed, so it's resolved automatically rather than left stuck
   * (Phase 5 additional requirements, Section 15).
   */
  private async saveRecommendations(userId: string, campaignId: string, candidates: RecommendationCandidate[]) {
    const existing = await this.db.select().from(campaignRecommendations)
      .where(and(eq(campaignRecommendations.campaignId, campaignId), eq(campaignRecommendations.status, "pending")));
    const freshCategories = new Set(candidates.map((c) => c.category));
    const existingCategories = new Set(existing.map((r) => r.category));

    const toStale = existing.filter((r) => !freshCategories.has(r.category));
    if (toStale.length) {
      await this.db.update(campaignRecommendations).set({ status: "stale", resolvedAt: new Date() })
        .where(inArray(campaignRecommendations.id, toStale.map((r) => r.id)));
    }
    const stillPending = existing.filter((r) => freshCategories.has(r.category));

    const toInsert = candidates.filter((cand) => !existingCategories.has(cand.category));
    const inserted = toInsert.length
      ? await this.db.insert(campaignRecommendations).values(toInsert.map((cand) => ({
          id: newId(), campaignId, ownerId: userId, kind: cand.kind, category: cand.category,
          title: cand.title, why: cand.observation, evidence: cand.evidence, diagnosis: cand.diagnosis,
          impact: cand.impact, confidence: cand.confidence, action: cand.recommendation ?? null,
          risk: cand.risk, approval: cand.approval, priority: cand.priority,
          payload: (cand.payload ?? {}) as never,
        }))).returning()
      : [];
    return [...stillPending, ...inserted].sort((a, b) => b.priority - a.priority || b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Phase 5 additional requirements, Sections 11 & 16 (lite): compares each
   * completed campaign's pre-launch forecast against its real outcome.
   * Never a trained model - every campaign already stores both numbers, so
   * this is a direct, explainable comparison, honest about not being
   * available until there's enough completed history to compare.
   */
  async forecastAccuracy(userId: string) {
    const rows = await this.read.select({
      id: campaigns.id, name: campaigns.name, forecast: campaigns.forecast,
      spendInr: campaigns.spendInr, qualifiedCount: campaigns.qualifiedCount,
    }).from(campaigns).where(and(eq(campaigns.ownerId, userId), eq(campaigns.status, "completed")));

    const inputs = rows
      .map((r) => {
        const f = r.forecast as { qualified?: number; costPerQualifiedLead?: number } | null;
        if (!f?.costPerQualifiedLead) return null;
        return {
          campaignId: r.id, name: r.name,
          forecastQualified: Number(f.qualified ?? 0), forecastCostPerQualifiedLeadInr: Number(f.costPerQualifiedLead),
          actualQualified: Number(r.qualifiedCount), actualSpendInr: Number(r.spendInr),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    return evaluateForecastAccuracy(inputs);
  }

  /** Approve, reject or dismiss a recommendation. None of these apply a change on their own - they just record the owner's decision. */
  async resolveRecommendation(userId: string, recId: string, status: "approved" | "rejected" | "dismissed") {
    const [row] = await this.db.select().from(campaignRecommendations).where(eq(campaignRecommendations.id, recId)).limit(1);
    if (!row || row.ownerId !== userId) throw new NotFoundException("That recommendation could not be found.");
    const [updated] = await this.db.update(campaignRecommendations).set({ status, resolvedAt: new Date() })
      .where(eq(campaignRecommendations.id, recId)).returning();
    return updated;
  }

  /** The cross-campaign health view: totals, the best-performing platform and locality, and anything pending approval. */
  async dashboard(userId: string) {
    const rows = await this.read.select().from(campaigns).where(eq(campaigns.ownerId, userId)).orderBy(desc(campaigns.createdAt));
    // Refreshes alerts/suggestions for every running campaign before showing them here -
    // this is the one place that computes them, so visiting this page is what keeps them current.
    for (const c of rows) if (c.status === "active" || c.status === "paused") await this.insights(userId, c.id).catch(() => null);

    const totals = rows.reduce((acc, c) => ({
      spendInr: acc.spendInr + Number(c.spendInr), leads: acc.leads + Number(c.leadsCount), qualified: acc.qualified + Number(c.qualifiedCount),
    }), { spendInr: 0, leads: 0, qualified: 0 });

    const deliveryRows = await this.rows<{ platform: string; spendPaise: number }>(sql`
      select d.platform, d.spend_paise as "spendPaise" from campaign_deliveries d join campaigns c on c.id = d.campaign_id where c.owner_id = ${userId}`);
    const leadRows = await this.rows<{ source: string; qualified: boolean; city: string | null; locality: string | null }>(sql`
      select l.source, l.qualified, l.city, l.locality from leads l join campaigns c on c.id = l.campaign_id where c.owner_id = ${userId}`);

    const platformSpend = new Map<string, number>(), platformQualified = new Map<string, number>();
    for (const d of deliveryRows) platformSpend.set(d.platform, (platformSpend.get(d.platform) ?? 0) + Number(d.spendPaise));
    for (const l of leadRows) if (l.qualified && (l.source === "meta" || l.source === "google")) platformQualified.set(l.source, (platformQualified.get(l.source) ?? 0) + 1);
    let bestPlatform: { platform: string; costPerQualifiedLeadInr: number } | null = null;
    for (const [platform, qualified] of platformQualified) {
      const spendInr = (platformSpend.get(platform) ?? 0) / 100;
      const cpl = qualified ? spendInr / qualified : Infinity;
      if (Number.isFinite(cpl) && (!bestPlatform || cpl < bestPlatform.costPerQualifiedLeadInr)) bestPlatform = { platform, costPerQualifiedLeadInr: Math.round(cpl) };
    }

    const localityMap = new Map<string, { leads: number; qualified: number }>();
    for (const l of leadRows) {
      const label = l.locality || l.city;
      if (!label) continue;
      const cur = localityMap.get(label) ?? { leads: 0, qualified: 0 };
      cur.leads++; if (l.qualified) cur.qualified++;
      localityMap.set(label, cur);
    }
    let bestLocality: { label: string; qualified: number; leads: number } | null = null;
    for (const [label, v] of localityMap) {
      if (v.leads >= 3 && (!bestLocality || v.qualified / v.leads > bestLocality.qualified / bestLocality.leads)) bestLocality = { label, ...v };
    }

    const scored = rows.filter((c) => Number(c.qualifiedCount) > 0)
      .map((c) => ({ id: c.id, name: c.name, costPerQualifiedLeadInr: Math.round(Number(c.spendInr) / Number(c.qualifiedCount)) }))
      .sort((a, b) => a.costPerQualifiedLeadInr - b.costPerQualifiedLeadInr);
    const bestCampaign = scored[0] ?? null;

    const pending = await this.db.select().from(campaignRecommendations)
      .where(and(eq(campaignRecommendations.ownerId, userId), eq(campaignRecommendations.status, "pending")))
      .orderBy(desc(campaignRecommendations.priority), desc(campaignRecommendations.createdAt)).limit(50);

    return {
      campaigns: rows.map((c) => ({ id: c.id, name: c.name, status: c.status, spendInr: Number(c.spendInr), leadsCount: Number(c.leadsCount), qualifiedCount: Number(c.qualifiedCount) })),
      totals, bestPlatform, bestLocality, bestCampaign, pending,
    };
  }

  /** Runs a read query and returns its rows, whichever shape the driver gave back. */
  private async rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
    const r = await this.read.execute(q);
    return (Array.isArray(r) ? r : (r as unknown as { rows: T[] }).rows) as T[];
  }

  /** Renames a draft or rejected campaign; it isn't running yet, so nothing else changes. */
  async rename(userId: string, id: string, name: string) {
    const row = await this.get(userId, id);
    if (row.status !== "draft" && row.status !== "rejected") throw new BadRequestException("You can only rename a campaign before it's sent for review.");
    const clean = name.trim().slice(0, 160);
    if (!clean) throw new BadRequestException("Give the campaign a name.");
    await this.db.update(campaigns).set({ name: clean }).where(eq(campaigns.id, id));
    return { ok: true, name: clean };
  }

  /** Deletes a campaign that was never sent for review, or whose review ended in rejection (no money is held either way). */
  async remove(userId: string, id: string) {
    const row = await this.get(userId, id);
    if (row.status !== "draft" && row.status !== "rejected") {
      throw new BadRequestException("This campaign has been sent for review. Take it back first, or end it, before deleting it.");
    }
    await this.db.delete(campaigns).where(eq(campaigns.id, id));
    return { ok: true };
  }
}

const inr = (n: number) => (!n ? "price on request" : n >= 1e7 ? `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr` : `₹${Math.round(n / 1e5)} L`);
