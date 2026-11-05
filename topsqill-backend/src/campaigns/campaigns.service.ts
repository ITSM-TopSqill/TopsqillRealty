import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { campaigns, listings, requirements, users } from "../db/schema";
import { ClaudeService } from "../ai/claude.service";
import { SearchService } from "../search/search.service";
import { buildPlan, forecast, segmentOf, type Plan } from "./planner";
import { pincodesFor, HNI_FEEDERS } from "./pincodes";
import { newId } from "../common/ids";

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
