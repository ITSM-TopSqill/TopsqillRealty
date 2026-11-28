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

const MAX_MANUAL_ADS = 10;

type Analysis = {
  visualStrategy: string; copyStrategy: string; commercialStrategy: string;
  classification: string[]; confidence: "low" | "medium" | "high";
};

type ManualAd = { pageName: string; headline?: string; body?: string };

/**
 * Competitor Creative Analyser (Module 3): a real, structured AI breakdown
 * of a batch of ads - visual strategy, copy strategy, commercial strategy
 * and a classification, kept as distinct fields from the raw ad text so
 * inferred strategy is never confused with what the source actually
 * returned. Persisted (so a member can come back to it) and never falls
 * back to a rules-based guess - if AI is off or the request fails, nothing
 * is saved rather than writing a low-confidence placeholder as real
 * analysis.
 *
 * Two ways in: `analyse` (a real Meta Ad Library search - UK/EU only,
 * ads_archive's actual scope) and `analyseManual` (ads typed in by hand -
 * the only option everywhere else, India included). Both run the same
 * prompt and store `inputSource` so the UI never blurs the two together.
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
    await this.assertOwnsCompetitor(userId, competitorId);
    await this.assertAiEnabled();

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

    return this.runAndSave(userId, term, competitorId, corpus, results.length, "meta_api");
  }

  /**
   * Analyse ads the member typed in by hand - the only honest option for a
   * market (India included) that ads_archive doesn't serve. Same prompt,
   * same persisted shape, `inputSource: "manual"` so it's never mistaken
   * for a real Ad Library fetch.
   */
  async analyseManual(userId: string, label: string, ads: ManualAd[], competitorId?: string) {
    const clean = (ads ?? [])
      .map((a) => ({ pageName: a.pageName?.trim().slice(0, 160) ?? "", headline: a.headline?.trim().slice(0, 300) ?? "", body: a.body?.trim().slice(0, 2000) ?? "" }))
      .filter((a) => a.pageName && (a.headline || a.body))
      .slice(0, MAX_MANUAL_ADS);
    if (!clean.length) throw new BadRequestException("Add at least one ad with an advertiser name and some headline or body text.");
    const term = label?.trim().slice(0, 200) || clean[0].pageName;
    await this.assertOwnsCompetitor(userId, competitorId);
    await this.assertAiEnabled();

    const corpus = clean.map((r, i) => `${i + 1}. ${r.pageName}: "${r.headline}" — ${r.body}`).join("\n");
    return this.runAndSave(userId, term, competitorId, corpus, clean.length, "manual");
  }

  private async assertOwnsCompetitor(userId: string, competitorId?: string) {
    if (!competitorId) return;
    const [row] = await this.read.select({ id: competitors.id }).from(competitors)
      .where(and(eq(competitors.id, competitorId), eq(competitors.ownerId, userId))).limit(1);
    if (!row) throw new BadRequestException("That competitor could not be found.");
  }

  private async assertAiEnabled() {
    if (!(await this.claude.enabledFor("competitive-intelligence"))) {
      throw new BadRequestException("AI is off right now, so a creative-strategy analysis can't be generated.");
    }
  }

  private async runAndSave(userId: string, label: string, competitorId: string | undefined, corpus: string, adCount: number, inputSource: "meta_api" | "manual") {
    const fallback = (): Analysis => ({ visualStrategy: "", copyStrategy: "", commercialStrategy: "", classification: [], confidence: "low" });
    const { data, source } = await this.claude.json<Analysis>(
      `These are ${adCount} real ads${inputSource === "meta_api" ? ` found via Meta's Ad Library for the search "${label}"` : " typed in by a member for the competitor/search label " + JSON.stringify(label)}:\n${corpus}\n\n` +
      `Only the ad text (and, for Ad Library results, platform and how long an ad has run) is real - no performance numbers (CTR, ROAS, spend, conversions) are available or should be mentioned. ` +
      `Write a structured creative-strategy breakdown:\n` +
      `- visualStrategy: 2-4 sentences on what the ad text/format implies about visual approach (image vs video mentions, carousel, product demo language, UGC-style tone) - say plainly when the text doesn't reveal enough to judge this.\n` +
      `- copyStrategy: 2-4 sentences on headline structure, opening hooks, emotional positioning, offers/discounts/urgency, social proof, CTA patterns actually present in the text above.\n` +
      `- commercialStrategy: 2-4 sentences on product positioning, price/offer visibility, apparent target customer, differentiation signals.\n` +
      `- classification: 1-4 labels from exactly this list: ${CLASSIFICATIONS.join(", ")}.\n` +
      `- confidence: "low"|"medium"|"high" - reflecting how much the ${adCount} ad(s) actually support these conclusions (fewer or thinner ads = lower confidence).\n` +
      `Never state or imply a conversion rate, ROAS, budget or sales figure - that data isn't in the input. Reply with JSON only: {"visualStrategy":"","copyStrategy":"","commercialStrategy":"","classification":[],"confidence":"low"}.`,
      fallback, { userId, feature: "competitive-intelligence", effort: "medium", maxTokens: 900 },
    );
    if (source !== "claude" || !data.visualStrategy?.trim()) {
      throw new BadRequestException("Couldn't generate an analysis right now - please try again shortly.");
    }

    const classification = (data.classification ?? []).filter((c) => (CLASSIFICATIONS as readonly string[]).includes(c)).slice(0, 4);
    const confidence = data.confidence === "high" || data.confidence === "medium" ? data.confidence : "low";

    const [row] = await this.db.insert(competitorCreativeAnalyses).values({
      id: newId(), ownerId: userId, competitorId: competitorId ?? null, searchTerms: label.slice(0, 200),
      adCount,
      visualStrategy: data.visualStrategy.trim().slice(0, 1000),
      copyStrategy: data.copyStrategy.trim().slice(0, 1000),
      commercialStrategy: data.commercialStrategy.trim().slice(0, 1000),
      classification, confidence, source: "claude", inputSource,
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
