import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { projects, listings, users } from "../db/schema";
import { ClaudeService } from "./claude.service";
import { SearchService } from "../search/search.service";
import { ListingsService } from "../listings/listings.service";
import { extractProject, estimatePrices, type Extracted } from "./extract";
import { newId } from "../common/ids";
import { cleanUrl } from "../common/safe-fetch";
import { PageFetcher } from "./page-fetcher.service";
import { scrubList, scrubSources } from "../common/sources";

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
    private readonly search: SearchService,
    private readonly listingsSvc: ListingsService,
    private readonly pages: PageFetcher,
  ) {}

  /**
   * Builds a full project from a link plus (ideally) the page text.
   * The rule-based extractor always runs; Claude refines it when available.
   * Both paths produce the same shape, so the app behaves the same either way.
   */
  async importFromUrl(userId: string, input: { url?: string; text?: string }) {
    if (!input.url && !input.text) throw new BadRequestException("Paste a link or the page text first.");
    // With only a link, read the page ourselves (safely). Pasted text still
    // wins: some sites block robots or build the page in the browser.
    if (input.url && (input.text ?? "").trim().length < 200) {
      let url: string;
      try { url = cleanUrl(input.url); } catch (e) { throw new BadRequestException((e as Error).message); }
      const fetched = await this.pages.fetch(userId, url, { paid: !(input.text ?? "").trim() });
      input = { ...input, url };
      if (fetched.page) input.text = [fetched.page.title, fetched.page.description, fetched.page.text, input.text].filter(Boolean).join("\n");
      else if (!input.text) throw new BadRequestException(`${fetched.error || "The page couldn’t be opened."} Copy the page text and paste it below the link.`);
    }
    const base = extractProject(input.url ?? "", input.text ?? "");

    let merged: Extracted = base;
    let aiSource: "claude" | "rules" = "rules";
    if (input.text && this.claude.available) {
      const prompt = `Extract this Indian residential project into JSON. Return ONLY JSON with keys:
name, builder, city, locality, reraNumber, status ("New launch"|"Under construction"|"Ready to move"), possession,
acres (number), towers (number), floors (number), units (number), openArea (percent number), paymentPlan,
facing (array), amenities (array, max 12), specs (array, max 8),
configs (array of {bhk, sbua in sq ft, carpet, price in INR or 0 if not stated}),
nearby (array of {name, km}).
Convert square metres to square feet by multiplying by 10.764. Use only facts in the text; use "" or 0 when missing.

URL: ${input.url ?? "not given"}
Text: """${input.text.slice(0, 12000)}"""`;
      const { data, source } = await this.claude.json<Partial<Extracted>>(prompt, () => base, { userId, feature: "project.extract", maxTokens: 2000, cacheSeconds: 3600 });
      aiSource = source;
      merged = this.merge(base, data);
    }

    // Nothing published may name or link the site it came from.
    merged.name = scrubSources(merged.name) || "New project";
    merged.builder = scrubSources(merged.builder);
    merged.locality = scrubSources(merged.locality);
    merged.amenities = scrubList(merged.amenities);

    const stats = await this.search.localityStats(merged.locality || merged.city, merged.city);
    const rate = Number((stats as Record<string, unknown> | null)?.avgRatePerSqft ?? 0) || 7000;
    const configs = estimatePrices(merged.configs, rate);
    const priceEstimated = configs.some((c) => c.estimated);
    const avgRate = Math.round(configs.reduce((s, c) => s + c.price / Math.max(c.sbua, 1), 0) / configs.length);

    const risk = this.riskReport(merged, avgRate, rate);
    const insights = await this.insights(userId, merged, configs, rate, risk);

    const id = newId();
    const [row] = await this.db.insert(projects).values({
      id, ownerId: userId, sourceUrl: input.url ?? null,
      name: merged.name, builder: merged.builder || null, city: merged.city || "Unknown", locality: merged.locality || merged.city || "Unknown",
      reraNumber: merged.reraNumber || null, status: merged.status, possession: merged.possession || null,
      acres: merged.acres ? String(merged.acres) : null, towers: merged.towers || null, floors: merged.floors || null,
      units: merged.units || null, openArea: merged.openArea || null, paymentPlan: merged.paymentPlan || null,
      facing: merged.facing, amenities: merged.amenities, specs: merged.specs,
      configs, nearby: merged.nearby, usps: scrubList(insights.usps), summary: scrubSources(insights.summary), verdict: scrubSources(insights.verdict),
      risk, priceEstimated, aiSource,
    }).returning();
    return row;
  }

  /** AI values win when present; the extractor fills every gap. */
  private merge(base: Extracted, ai: Partial<Extracted>): Extracted {
    const out: Extracted = { ...base };
    for (const key of Object.keys(base) as (keyof Extracted)[]) {
      const v = (ai as Record<string, unknown>)[key];
      if (v === undefined || v === null || v === "" || v === 0) continue;
      if (Array.isArray(v) && !v.length) continue;
      (out as Record<string, unknown>)[key] = v;
    }
    const aiConfigs = (ai.configs ?? []).filter((c) => c && Number(c.bhk) >= 1 && Number(c.sbua) > 0)
      .map((c) => ({ bhk: Number(c.bhk), sbua: Number(c.sbua), carpet: Number(c.carpet) || Math.round(Number(c.sbua) * 0.7), price: Number(c.price) || 0 }));
    if (aiConfigs.length) out.configs = aiConfigs.sort((a, b) => a.bhk - b.bhk);
    const aiNearby = (ai.nearby ?? []).filter((n) => n?.name && Number(n.km) > 0)
      .map((n) => ({ name: String(n.name), km: Number(n.km), icon: n.icon ?? "📍" }));
    if (aiNearby.length) out.nearby = aiNearby;
    return out;
  }

  /** An honest risk report, so buyers see what to check before paying anything. */
  private riskReport(p: Extracted, projectRate: number, localityRate: number) {
    const deviation = localityRate ? Math.round((projectRate / localityRate - 1) * 100) : 0;
    const factors = [
      { label: "RERA registration", level: p.reraNumber ? "low" : "high",
        note: p.reraNumber ? `Registered as ${p.reraNumber}. Check it on the state RERA website before paying.` : "No RERA number found. Don’t pay any token until it is verified." },
      { label: "Possession", level: p.status === "Ready to move" ? "low" : "medium",
        note: p.status === "Ready to move" ? "Ready to move, so there is no construction risk." : `Under construction${p.possession ? `, possession ${p.possession}` : ""}. Ask for the delay penalty clause.` },
      { label: "Price versus the locality", level: Math.abs(deviation) > 20 ? "high" : Math.abs(deviation) > 8 ? "medium" : "low",
        note: localityRate ? `${Math.abs(deviation)}% ${deviation >= 0 ? "above" : "below"} the ${p.locality || p.city} average of ₹${localityRate.toLocaleString("en-IN")} per sq ft.` : "Not enough nearby listings to compare prices yet." },
      { label: "Title and approvals", level: "medium",
        note: "Ask for the title search report, the approved building plan and the environment clearance." },
    ];
    const points: Record<string, number> = { low: 0, medium: 1, high: 2 };
    const score = Math.round(100 - (factors.reduce((a, f) => a + points[f.level], 0) / (factors.length * 2)) * 100);
    return { score, level: score >= 75 ? "Low" : score >= 55 ? "Medium" : "High", factors, deviation };
  }

  private async insights(userId: string, p: Extracted, configs: { bhk: number; price: number }[], rate: number, risk: { level: string }) {
    const fallback = () => {
      const usps: string[] = [];
      if (p.towers && p.floors) usps.push(`${p.towers} towers of ${p.floors} floors`);
      if (p.acres) usps.push(`${p.acres} acres${p.openArea ? ` with ${p.openArea}% open green` : ""}`);
      const metro = p.nearby.find((n) => /metro/i.test(n.name));
      if (metro) usps.push(`${metro.km} km from ${metro.name}`);
      usps.push(...p.amenities.slice(0, 3));
      if (p.paymentPlan) usps.push(`${p.paymentPlan} payment plan`);
      const lo = configs[0], hi = configs[configs.length - 1];
      return {
        usps: usps.slice(0, 6),
        summary: `${p.name}${p.builder ? ` by ${p.builder}` : ""} offers ${configs.map((c) => `${c.bhk} BHK`).join(", ")} homes in ${p.locality || p.city}, from ${inr(lo?.price ?? 0)}${hi && hi.price > (lo?.price ?? 0) ? ` to ${inr(hi.price)}` : " onwards"}.`,
        verdict: risk.level === "Low" ? "A sensible, low-risk option for end users, priced in line with the area."
          : risk.level === "Medium" ? "Worth a look. Check the builder’s delivery record and negotiate before booking."
          : "Proceed carefully. Several checks need answers before you pay any token.",
      };
    };
    if (!this.claude.available) return fallback();
    const prompt = `Write listing copy for an Indian property project. Return ONLY JSON {"usps":[6 short points, max 8 words each],"summary":"50-70 words","verdict":"max 30 words, honest"}.
Never promise returns. Use only these facts: ${JSON.stringify({ name: p.name, builder: p.builder, locality: p.locality, city: p.city, configs, amenities: p.amenities, acres: p.acres, towers: p.towers, floors: p.floors, openArea: p.openArea, nearby: p.nearby.slice(0, 5), possession: p.possession, paymentPlan: p.paymentPlan, localityRatePerSqft: rate, riskLevel: risk.level })}`;
    const { data } = await this.claude.json<{ usps: string[]; summary: string; verdict: string }>(prompt, fallback, { userId, feature: "project.insights", maxTokens: 800 });
    return {
      usps: Array.isArray(data.usps) && data.usps.length ? data.usps.slice(0, 6).map(String) : fallback().usps,
      summary: typeof data.summary === "string" && data.summary ? data.summary : fallback().summary,
      verdict: typeof data.verdict === "string" && data.verdict ? data.verdict.slice(0, 300) : fallback().verdict,
    };
  }

  async get(id: string) {
    const [row] = await this.read.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) throw new NotFoundException("That project could not be found.");
    // Where it was imported from is kept for audit, never shown publicly.
    const { sourceUrl: _source, ...pub } = row;
    return pub;
  }

  async mine(userId: string) {
    const rows = await this.read.select().from(projects).where(eq(projects.ownerId, userId)).orderBy(desc(projects.createdAt)).limit(50);
    return { items: rows };
  }

  /** Publishing creates one live listing per configuration, linked back to the project. */
  async publish(userId: string, id: string) {
    const p = await this.get(id);
    if (p.ownerId !== userId) throw new NotFoundException("That project could not be found.");

    // Claim the project first, atomically, so a double click or a retry can
    // never publish the same configurations twice.
    const [claimed] = await this.db.update(projects).set({ published: true, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.ownerId, userId), eq(projects.published, false)))
      .returning({ id: projects.id });
    if (!claimed) throw new ConflictException("This project has already been published.");

    const created: string[] = [];
    try {
      for (const c of p.configs) {
        const listing = await this.listingsSvc.create(userId, {
          title: `${c.bhk} BHK in ${p.name}, ${p.locality}`,
          purpose: "sale", kind: "Apartment", bhk: c.bhk, areaSqft: c.sbua, priceInr: c.price,
          city: p.city, locality: p.locality, possession: p.status === "Ready to move" ? "Ready to move" : "Under construction",
          description: p.summary ?? undefined, amenities: p.amenities, usps: p.usps,
          // Imported from text the member pasted, so nothing here is verified:
          // only an admin sets `verified`.
          reraNumber: p.reraNumber ?? undefined, verified: false, projectSourceId: p.id, status: "active",
        } as never);
        created.push(listing.id);
      }
    } catch (e) {
      // If nothing was created, release the claim so the member can retry. After
      // a partial run the project stays published, so a retry cannot duplicate
      // the listings that did go live.
      if (!created.length) await this.db.update(projects).set({ published: false }).where(eq(projects.id, id));
      throw e;
    }
    return { ok: true, listingIds: created };
  }
}

const inr = (n: number) => (!n ? "price on request" : n >= 1e7 ? `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr` : `₹${Math.round(n / 1e5)} L`);
