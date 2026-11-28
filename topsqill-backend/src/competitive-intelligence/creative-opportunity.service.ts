import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { creativeConcepts, marketGapAnalyses, competitiveStrategies, competitors } from "../db/schema";
import { newId } from "../common/ids";
import { ClaudeService } from "../ai/claude.service";
import { CONCEPT_FORMATS, validateConcepts, type CreativeConcept } from "./creative-opportunity";
import type { MarketGapOpportunity } from "./market-gap";
import type { CompetitiveStrategyItem } from "./strategy";

const MAX_CONCEPTS = 3;

type GenerateInput = {
  marketGapAnalysisId?: string; opportunityId?: string;
  competitiveStrategyId?: string; strategyItemId?: string;
};

/**
 * Creative Opportunity Generator (Module 7): original campaign concepts
 * (angle, headlines, primary texts, CTA variations, visual/video/carousel
 * ideas) grounded in exactly one APPROVED market-gap opportunity or
 * competitive-strategy item - never a bare prompt with no real evidence,
 * and never a reproduction of a competitor's actual ad text. A competitor
 * may be named as context ("differs from X's price-led messaging") but
 * its creative is never copied. No rules fallback: a failed AI call
 * refuses rather than guessing generic copy.
 */
@Injectable()
export class CreativeOpportunityService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
  ) {}

  async generate(userId: string, input: GenerateInput) {
    const fromGap = !!(input.marketGapAnalysisId && input.opportunityId);
    const fromStrategy = !!(input.competitiveStrategyId && input.strategyItemId);
    if (fromGap === fromStrategy) {
      throw new BadRequestException("Ground this in exactly one approved market-gap opportunity or one approved strategy - not both, not neither.");
    }

    let groundingText = "";
    let label = "";
    let competitorNames: string[] = [];

    if (fromGap) {
      const [gap] = await this.read.select().from(marketGapAnalyses)
        .where(and(eq(marketGapAnalyses.id, input.marketGapAnalysisId!), eq(marketGapAnalyses.ownerId, userId))).limit(1);
      if (!gap) throw new BadRequestException("That market-gap analysis could not be found.");
      const opp = (gap.opportunities as unknown as MarketGapOpportunity[]).find((o) => o.id === input.opportunityId);
      if (!opp) throw new BadRequestException("That opportunity could not be found.");
      if ((gap.decisions as Record<string, string>)[opp.id] !== "approved") {
        throw new BadRequestException("Approve this opportunity first - concepts are only generated from opportunities you've actually accepted.");
      }
      label = opp.opportunity.slice(0, 200);
      groundingText = `Market-gap opportunity: ${opp.opportunity}\nEvidence: ${opp.evidence}\nWhy it matters: ${opp.businessRelevance}\nSuggested campaign: ${opp.suggestedCampaign}\nSuggested creative angle: ${opp.suggestedCreative}\nSuggested audience: ${opp.suggestedAudience}`;
      competitorNames = await this.competitorNamesFor(userId, gap.competitorIds as string[]);
    } else {
      const [batch] = await this.read.select().from(competitiveStrategies)
        .where(and(eq(competitiveStrategies.id, input.competitiveStrategyId!), eq(competitiveStrategies.ownerId, userId))).limit(1);
      if (!batch) throw new BadRequestException("That strategy generation could not be found.");
      const strat = (batch.strategies as unknown as CompetitiveStrategyItem[]).find((s) => s.id === input.strategyItemId);
      if (!strat) throw new BadRequestException("That strategy could not be found.");
      if ((batch.decisions as Record<string, string>)[strat.id] !== "approved") {
        throw new BadRequestException("Approve this strategy first - concepts are only generated from strategies you've actually accepted.");
      }
      label = strat.label.slice(0, 200);
      groundingText = `Strategy: ${strat.label}\nRationale: ${strat.rationale}\nPositioning: ${strat.positioning}\nTarget segment: ${strat.targetSegment}\nKey message: ${strat.keyMessage}\nDifferentiation: ${strat.differentiation}`;
      competitorNames = await this.competitorNamesFor(userId, batch.competitorIds as string[]);
    }

    if (!(await this.claude.enabledFor("competitive-intelligence"))) {
      throw new BadRequestException("AI is off right now, so creative concepts can't be generated.");
    }

    const formatList = CONCEPT_FORMATS.join(", ");
    const fallback = () => ({ concepts: [] as CreativeConcept[] });
    const { data, source } = await this.claude.json<{ concepts?: CreativeConcept[] }>(
      `${groundingText}\n${competitorNames.length ? `\nCompetitors this should differentiate from (by name, as context only - NEVER copy or closely paraphrase their actual ad wording): ${competitorNames.join(", ")}` : ""}\n\n` +
      `Generate up to ${MAX_CONCEPTS} distinct ORIGINAL campaign concepts for this opportunity/strategy. Each must be a genuinely different angle, not a reworded duplicate of another. ` +
      `For each: angle (1 sentence, the overall idea), headlines (2-3 original headline variations), primaryTexts (2-3 original body-copy variations, 1-2 sentences each), ctaVariations (2-3 short CTAs), visualConcept (1-2 sentences describing a static-image idea - composition/subject, not a generated image), videoConcept (1-2 sentences describing a short video or storyboard idea), carouselConcept (1 sentence describing a carousel structure, or "" if a carousel doesn't fit), format (exactly one of: ${formatList}), confidence ("low"|"medium"|"high" - how well-grounded this concept is in the evidence given). ` +
      `Never reproduce a competitor's actual headline, tagline or ad copy - these must be original to this business. Never invent a fact about the business (a price, a certification, an award) that wasn't given to you. ` +
      `Reply with JSON only: {"concepts": [{"id": "concept-1", "angle": "", "headlines": [], "primaryTexts": [], "ctaVariations": [], "visualConcept": "", "videoConcept": "", "carouselConcept": "", "format": "", "confidence": "low"}]}.`,
      fallback, { userId, feature: "competitive-intelligence", effort: "medium", maxTokens: 2200 },
    );
    if (source !== "claude" || !data.concepts?.length) {
      throw new BadRequestException("Couldn't generate concepts right now - please try again shortly.");
    }

    const concepts = data.concepts.slice(0, MAX_CONCEPTS).map((c, i) => ({
      ...c, id: c.id || `concept-${i + 1}`,
      format: (CONCEPT_FORMATS as readonly string[]).includes(c.format) ? c.format : "Consideration",
      confidence: (["low", "medium", "high"].includes(c.confidence) ? c.confidence : "low") as CreativeConcept["confidence"],
    }));
    validateConcepts(concepts);

    const [row] = await this.db.insert(creativeConcepts).values({
      id: newId(), ownerId: userId, label,
      marketGapAnalysisId: input.marketGapAnalysisId ?? null, opportunityId: input.opportunityId ?? null,
      competitiveStrategyId: input.competitiveStrategyId ?? null, strategyItemId: input.strategyItemId ?? null,
      concepts: concepts as never, source: "claude",
    }).returning();
    return row;
  }

  private async competitorNamesFor(userId: string, ids: string[]) {
    if (!ids?.length) return [];
    const idSet = new Set(ids);
    const rows = await this.read.select({ id: competitors.id, name: competitors.name }).from(competitors).where(eq(competitors.ownerId, userId));
    return rows.filter((r) => idSet.has(r.id)).map((r) => r.name).slice(0, 5);
  }

  async get(userId: string, id: string) {
    const [row] = await this.read.select().from(creativeConcepts).where(and(eq(creativeConcepts.id, id), eq(creativeConcepts.ownerId, userId))).limit(1);
    if (!row) throw new NotFoundException("That creative-concept batch could not be found.");
    return row;
  }

  async list(userId: string) {
    const rows = await this.read.select().from(creativeConcepts).where(eq(creativeConcepts.ownerId, userId)).orderBy(desc(creativeConcepts.createdAt));
    return { items: rows };
  }

  async resolveConcept(userId: string, id: string, conceptId: string, decision: "approved" | "rejected") {
    const row = await this.get(userId, id);
    const decisions = { ...(row.decisions ?? {}), [conceptId]: decision };
    const [updated] = await this.db.update(creativeConcepts).set({ decisions: decisions as never }).where(eq(creativeConcepts.id, id)).returning();
    return updated;
  }
}
