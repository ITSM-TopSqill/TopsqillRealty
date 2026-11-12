import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { campaigns, listings, requirements, users } from "../db/schema";
import { ClaudeService } from "../ai/claude.service";
import { SearchService } from "../search/search.service";
import { buildPlan, forecast, segmentOf, type Plan } from "./planner";
import { pincodesFor, HNI_FEEDERS } from "./pincodes";
import { newId } from "../common/ids";
import { speakMp3 } from "../common/tts";
import { writePublic, publicBase } from "../media/storage";
import { createHash } from "node:crypto";

export type PodcastLine = { host: "Priya" | "Arjun"; line: string };
export type Podcast = { script: PodcastLine[]; audioUrl: string | null; seconds: number; source: "claude" | "rules"; at: string };

@Injectable()
export class CampaignsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
    private readonly search: SearchService,
  ) {}

  /** Builds the whole campaign: targeting, channels, creatives and a forecast. */
  async create(userId: string, input: { listingId: string; goal?: string; budgetInr: number; days?: number; notes?: string }) {
    const [listing] = await this.read.select().from(listings).where(eq(listings.id, input.listingId)).limit(1);
    if (!listing) throw new NotFoundException("That listing could not be found.");
    if (listing.ownerId !== userId) throw new ForbiddenException("You can only promote your own listings.");
    if (input.budgetInr < 5000) throw new BadRequestException("The minimum campaign budget is ₹5,000.");

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

    const segment = segmentOf(listing.purpose, listing.priceInr ?? 0);
    const fc = forecast(plan, input.budgetInr, segment);
    const creatives = await this.creatives(userId, listing, plan, input.notes);

    const id = newId();
    const [row] = await this.db.insert(campaigns).values({
      id, ownerId: userId, listingId: listing.id,
      name: `${listing.title} | ${input.goal ?? "Qualified buyers"}`,
      goal: input.goal ?? "Qualified buyers", budgetInr: input.budgetInr, days: input.days ?? 15,
      plan: plan as never, creatives: creatives as never, forecast: fc as never,
    }).returning();
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
    const fallback = () => ({
      headlines: [`${bhk} in ${l.locality} at ${inr(l.priceInr ?? 0)}`.trim(), "Your family’s next home is here", `${l.possession ?? "Ready"}: ${l.locality}`],
      primaryTexts: [
        `🏡 ${l.title}. ${l.facing ?? ""} ${l.possession?.toLowerCase() ?? ""}, with ${amenities.join(", ").toLowerCase()}. ${Number(l.areaSqft ?? 0).toLocaleString("en-IN")} sq ft at ${inr(l.priceInr ?? 0)}. Tap to book a site visit this weekend.`.replace(/\s+/g, " "),
        `Looking in ${l.locality}? This ${bhk} has everything on your list. Get the floor plan and price sheet in one tap.`,
      ],
      hinglish: `${l.locality} mein apna ${bhk} ghar, ${inr(l.priceInr ?? 0)} mein 🏡 Site visit is weekend book karein!`,
      carousel: [
        { title: bhk || l.kind, sub: `${Number(l.areaSqft ?? 0).toLocaleString("en-IN")} sq ft` },
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
        descriptions: [`${bhk} in ${l.locality}, ${l.city}. ${amenities.slice(0, 2).join(", ")}. Get the price sheet now.`, "Talk to a verified expert. Free site visit and home loan help."],
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

  /**
   * Launch marks the campaign active. The ad platform APIs are connected in the
   * next step; until then nothing is spent, which is deliberate: no money moves
   * until a real account is linked and the member has confirmed it.
   */
  async launch(userId: string, id: string) {
    const c = await this.get(userId, id);
    if (c.status === "active") return c;
    const [row] = await this.db.update(campaigns)
      .set({ status: "active", launchedAt: new Date(), updatedAt: new Date() })
      .where(eq(campaigns.id, id)).returning();
    return row;
  }

  async setStatus(userId: string, id: string, status: "paused" | "active" | "completed") {
    await this.get(userId, id);
    const [row] = await this.db.update(campaigns).set({ status, updatedAt: new Date() }).where(eq(campaigns.id, id)).returning();
    return row;
  }
}

const inr = (n: number) => (!n ? "price on request" : n >= 1e7 ? `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr` : `₹${Math.round(n / 1e5)} L`);
