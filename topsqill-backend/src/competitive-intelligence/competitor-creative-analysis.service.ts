import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { competitorCreativeAnalyses, competitors } from "../db/schema";
import { newId } from "../common/ids";
import { ClaudeService } from "../ai/claude.service";
import { env } from "../common/env";
import { searchAdLibrary, AdLibraryError, type AdLibraryResult } from "./ad-library";

const CLASSIFICATIONS = [
  "Awareness", "Education", "Consideration", "Conversion", "Retargeting", "Product demonstration",
  "Social proof", "Premium positioning", "Price promotion", "Seasonal promotion", "Brand storytelling",
  "Competitive differentiation",
] as const;

type Analysis = {
  visualStrategy: string; copyStrategy: string; commercialStrategy: string;
  classification: string[]; confidence: "low" | "medium" | "high";
};

/**
 * Competitor Creative Analyser (Module 3): a real, structured AI breakdown
 * of a batch of ads just fetched from Meta's public Ad Library - visual
 * strategy, copy strategy, commercial strategy and a classification, kept
 * as distinct fields from the raw ad text so inferred strategy is never
 * confused with what the source actually returned. Unlike the quick
 * "patterns" summary in CompetitiveIntelligenceService, this is persisted
 * (so a member can come back to it) and never falls back to a rules-based
 * guess - if AI is off or the request fails, nothing is saved rather than
 * writing a low-confidence placeholder as if it were real analysis.
 */
@Injectable()
export class CompetitorCreativeAnalysisService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
  ) {}

  async analyse(userId: string, searchTerms: string, competitorId?: string) {
    const term = searchTerms?.trim();
    if (!term) throw new BadRequestException("A search term (advertiser name, product or keyword) is needed.");
    if (competitorId) {
      const [row] = await this.read.select({ id: competitors.id }).from(competitors)
        .where(and(eq(competitors.id, competitorId), eq(competitors.ownerId, userId))).limit(1);
      if (!row) throw new BadRequestException("That competitor could not be found.");
    }
    if (!(await this.claude.enabledFor("competitive-intelligence"))) {
      throw new BadRequestException("AI is off right now, so a creative-strategy analysis can't be generated - the raw ad search still works without it.");
    }

    let results: AdLibraryResult[];
    try {
      results = await searchAdLibrary({ appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, accessToken: env.META_ACCESS_TOKEN, apiVersion: "v21.0", searchTerms: term, countries: ["IN"], limit: 25 });
    } catch (e) {
      if (e instanceof AdLibraryError) throw new BadRequestException(e.message);
      throw e;
    }
    if (!results.length) throw new BadRequestException("No currently or recently running ads found for that search - nothing to analyse.");

    const corpus = results.slice(0, 20).map((r, i) =>
      `${i + 1}. ${r.pageName} (${r.platforms.join("/") || "platform unknown"}, ${r.stillRunning ? "still running" : "stopped"}${r.daysObserved ? `, observed ${r.daysObserved}d` : ""}): "${r.headline ?? ""}" — ${r.body ?? ""}`,
    ).join("\n");

    const fallback = (): Analysis => ({ visualStrategy: "", copyStrategy: "", commercialStrategy: "", classification: [], confidence: "low" });
    const { data, source } = await this.claude.json<Analysis>(
      `These are ${results.length} real, currently or recently running Meta ads found for the search "${term}":\n${corpus}\n\n` +
      `Only ad text, platform, and how long each has run are real - no performance numbers (CTR, ROAS, spend, conversions) are available or should be mentioned. ` +
      `Write a structured creative-strategy breakdown:\n` +
      `- visualStrategy: 2-4 sentences on what the ad text/format implies about visual approach (image vs video mentions, carousel, product demo language, UGC-style tone) - say plainly when the text doesn't reveal enough to judge this.\n` +
      `- copyStrategy: 2-4 sentences on headline structure, opening hooks, emotional positioning, offers/discounts/urgency, social proof, CTA patterns actually present in the text above.\n` +
      `- commercialStrategy: 2-4 sentences on product positioning, price/offer visibility, apparent target customer, differentiation signals.\n` +
      `- classification: 1-4 labels from exactly this list: ${CLASSIFICATIONS.join(", ")}.\n` +
      `- confidence: "low"|"medium"|"high" - reflecting how much the ${results.length} ads actually support these conclusions (fewer or thinner ads = lower confidence).\n` +
      `Never state or imply a conversion rate, ROAS, budget or sales figure - that data isn't in the input. Reply with JSON only: {"visualStrategy":"","copyStrategy":"","commercialStrategy":"","classification":[],"confidence":"low"}.`,
      fallback, { userId, feature: "competitive-intelligence", effort: "medium", maxTokens: 900 },
    );
    if (source !== "claude" || !data.visualStrategy?.trim()) {
      throw new BadRequestException("Couldn't generate an analysis right now - please try again shortly.");
    }

    const classification = (data.classification ?? []).filter((c) => (CLASSIFICATIONS as readonly string[]).includes(c)).slice(0, 4);
    const confidence = data.confidence === "high" || data.confidence === "medium" ? data.confidence : "low";

    const [row] = await this.db.insert(competitorCreativeAnalyses).values({
      id: newId(), ownerId: userId, competitorId: competitorId ?? null, searchTerms: term.slice(0, 200),
      adCount: results.length,
      visualStrategy: data.visualStrategy.trim().slice(0, 1000),
      copyStrategy: data.copyStrategy.trim().slice(0, 1000),
      commercialStrategy: data.commercialStrategy.trim().slice(0, 1000),
      classification, confidence, source: "claude",
    }).returning();
    return row;
  }

  async list(userId: string, competitorId?: string, limit = 20) {
    const cap = Math.min(Math.max(limit, 1), 50);
    const where = competitorId
      ? and(eq(competitorCreativeAnalyses.ownerId, userId), eq(competitorCreativeAnalyses.competitorId, competitorId))
      : eq(competitorCreativeAnalyses.ownerId, userId);
    const rows = await this.read.select().from(competitorCreativeAnalyses).where(where).orderBy(desc(competitorCreativeAnalyses.createdAt)).limit(cap);
    return { items: rows };
  }
}
