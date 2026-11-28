import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { marketGapAnalyses, competitors, competitorCreativeAnalyses, businesses } from "../db/schema";
import { newId } from "../common/ids";
import { ClaudeService } from "../ai/claude.service";
import { validateOpportunities, type MarketGapOpportunity } from "./market-gap";

const MAX_COMPETITORS = 5;
const MAX_OPPORTUNITIES = 6;

/**
 * Competitive Market Gap Engine (Module 5): compares the member's own
 * business profile against their tracked (accepted) competitors and any
 * creative analyses already saved for them, and asks Claude for real,
 * evidence-grounded opportunities. Never a rules-based fallback - a gap
 * that isn't genuinely supported by the evidence given is worse than no
 * gap at all, so a failed/degraded AI call refuses rather than guesses.
 */
@Injectable()
export class MarketGapAnalysisService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
  ) {}

  async analyse(userId: string, input: { businessId?: string; competitorIds: string[] }) {
    const ids = [...new Set(input.competitorIds ?? [])].slice(0, MAX_COMPETITORS);
    if (!ids.length) throw new BadRequestException("Pick at least one tracked competitor to compare against.");

    const trackedCompetitors = await this.read.select().from(competitors)
      .where(and(eq(competitors.ownerId, userId), inArray(competitors.id, ids), eq(competitors.status, "accepted")));
    if (!trackedCompetitors.length) throw new BadRequestException("None of those competitors are accepted and tracked - accept them first.");

    let businessText = "";
    if (input.businessId) {
      const [biz] = await this.read.select().from(businesses).where(and(eq(businesses.id, input.businessId), eq(businesses.ownerId, userId))).limit(1);
      if (!biz) throw new BadRequestException("That business profile could not be found.");
      businessText = [
        `Business: ${biz.name}`, `Industry: ${biz.industryId}`,
        biz.businessModel && `Business model: ${biz.businessModel}`,
        biz.products && `Products/services: ${biz.products}`,
        biz.targetSegments && `Current target customers: ${biz.targetSegments}`,
        biz.geographicMarkets && `Markets: ${biz.geographicMarkets}`,
        biz.pricingNotes && `Pricing: ${biz.pricingNotes}`,
        biz.acquisitionGoals && `Acquisition goals: ${biz.acquisitionGoals}`,
      ].filter(Boolean).join("\n");
    }
    if (!businessText.trim()) throw new BadRequestException("Add a business profile first, so opportunities are grounded in your own positioning, not guessed.");

    const analyses = await this.read.select().from(competitorCreativeAnalyses)
      .where(and(eq(competitorCreativeAnalyses.ownerId, userId), inArray(competitorCreativeAnalyses.competitorId, trackedCompetitors.map((c) => c.id))))
      .orderBy(desc(competitorCreativeAnalyses.createdAt));

    const competitorText = trackedCompetitors.map((c) => {
      const own = analyses.filter((a) => a.competitorId === c.id).slice(0, 2);
      const analysisText = own.length
        ? own.map((a) => `  - Creative analysis (${a.confidence} confidence, ${a.inputSource === "manual" ? "entered by hand" : "Meta Ad Library"}): visual: ${a.visualStrategy} copy: ${a.copyStrategy} commercial: ${a.commercialStrategy} classification: ${a.classification.join(", ")}`).join("\n")
        : "  - No creative analysis saved for this competitor yet.";
      return `${c.name} (${c.category}${c.website ? `, ${c.website}` : ""})${c.rationale ? ` - ${c.rationale}` : ""}\n${analysisText}`;
    }).join("\n\n");

    if (!(await this.claude.enabledFor("competitive-intelligence"))) {
      throw new BadRequestException("AI is off right now, so market-gap opportunities can't be generated.");
    }

    const fallback = () => ({ opportunities: [] as MarketGapOpportunity[] });
    const { data, source } = await this.claude.json<{ opportunities?: MarketGapOpportunity[] }>(
      `My business:\n${businessText}\n\nMy tracked competitors:\n${competitorText}\n\n` +
      `Find up to ${MAX_OPPORTUNITIES} real, evidence-grounded growth opportunities for MY business by comparing it against these competitors. ` +
      `Rules: never claim a customer segment or message is "underserved" just because you didn't see a competitor ad about it - absence of evidence isn't evidence. ` +
      `Every opportunity must cite something concrete from the business profile or competitor data above as its evidence. If the competitor data is thin (no creative analyses saved), say so and keep confidence low rather than inventing detail. ` +
      `For each opportunity give: observation (what you noticed), evidence (the specific fact backing it), opportunity (what MY business could do), businessRelevance (why it matters for this specific business), suggestedCampaign (a short campaign idea), suggestedCreative (a short creative angle, not full copy), suggestedAudience (who to target), confidence ("low"|"medium"|"high"), risk (what could go wrong or be wrong about this read), validationExperiment (a small, cheap way to test it before committing budget). ` +
      `Reply with JSON only: {"opportunities": [{"id": "gap-1", "observation": "", "evidence": "", "opportunity": "", "businessRelevance": "", "suggestedCampaign": "", "suggestedCreative": "", "suggestedAudience": "", "confidence": "low", "risk": "", "validationExperiment": ""}]}.`,
      fallback, { userId, feature: "competitive-intelligence", effort: "medium", maxTokens: 2000 },
    );
    if (source !== "claude" || !data.opportunities?.length) {
      throw new BadRequestException("Couldn't generate opportunities right now - please try again shortly.");
    }

    const opportunities = data.opportunities.slice(0, MAX_OPPORTUNITIES).map((o, i) => ({
      ...o, id: o.id || `gap-${i + 1}`,
      confidence: (["low", "medium", "high"].includes(o.confidence) ? o.confidence : "low") as MarketGapOpportunity["confidence"],
    }));
    validateOpportunities(opportunities);

    const [row] = await this.db.insert(marketGapAnalyses).values({
      id: newId(), ownerId: userId, businessId: input.businessId ?? null,
      competitorIds: trackedCompetitors.map((c) => c.id), opportunities: opportunities as never, source: "claude",
    }).returning();
    return row;
  }

  async get(userId: string, id: string) {
    const [row] = await this.read.select().from(marketGapAnalyses).where(and(eq(marketGapAnalyses.id, id), eq(marketGapAnalyses.ownerId, userId))).limit(1);
    if (!row) throw new NotFoundException("That market-gap analysis could not be found.");
    return row;
  }

  async list(userId: string, businessId?: string) {
    const where = businessId ? and(eq(marketGapAnalyses.ownerId, userId), eq(marketGapAnalyses.businessId, businessId)) : eq(marketGapAnalyses.ownerId, userId);
    const rows = await this.read.select().from(marketGapAnalyses).where(where).orderBy(desc(marketGapAnalyses.createdAt));
    return { items: rows };
  }

  async resolveOpportunity(userId: string, id: string, opportunityId: string, decision: "approved" | "rejected") {
    const row = await this.get(userId, id);
    const decisions = { ...(row.decisions ?? {}), [opportunityId]: decision };
    const [updated] = await this.db.update(marketGapAnalyses).set({ decisions: decisions as never }).where(eq(marketGapAnalyses.id, id)).returning();
    return updated;
  }
}
