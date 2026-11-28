import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { competitiveStrategies, competitors, marketGapAnalyses, businesses } from "../db/schema";
import { newId } from "../common/ids";
import { ClaudeService } from "../ai/claude.service";
import { STRATEGY_TEMPLATES, validateStrategies, type CompetitiveStrategyItem } from "./strategy";
import type { MarketGapOpportunity } from "./market-gap";

const MAX_COMPETITORS = 5;

/**
 * Competitive Strategy Generator (Module 6): picks 1-3 of the fixed
 * STRATEGY_TEMPLATES that genuinely fit the member's business, tracked
 * competitors and (optionally) the approved opportunities from one Market
 * Gap analysis. Never a rules fallback - a strategy not grounded in real
 * evidence is worse than none, so a failed AI call refuses.
 */
@Injectable()
export class CompetitiveStrategyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
  ) {}

  async generate(userId: string, input: { businessId?: string; competitorIds: string[]; marketGapAnalysisId?: string }) {
    const ids = [...new Set(input.competitorIds ?? [])].slice(0, MAX_COMPETITORS);
    if (!ids.length) throw new BadRequestException("Pick at least one tracked competitor to build a strategy against.");

    const trackedCompetitors = await this.read.select().from(competitors)
      .where(and(eq(competitors.ownerId, userId), inArray(competitors.id, ids), eq(competitors.status, "accepted")));
    if (!trackedCompetitors.length) throw new BadRequestException("None of those competitors are accepted and tracked - accept them first.");

    let businessText = "";
    if (input.businessId) {
      const [biz] = await this.read.select().from(businesses).where(and(eq(businesses.id, input.businessId), eq(businesses.ownerId, userId))).limit(1);
      if (!biz) throw new BadRequestException("That business profile could not be found.");
      businessText = [
        `Business: ${biz.name}`, `Industry: ${biz.industryId}`,
        biz.products && `Products/services: ${biz.products}`,
        biz.targetSegments && `Current target customers: ${biz.targetSegments}`,
        biz.pricingNotes && `Pricing: ${biz.pricingNotes}`,
      ].filter(Boolean).join("\n");
    }
    if (!businessText.trim()) throw new BadRequestException("Add a business profile first, so strategies are grounded in your own positioning.");

    let gapText = "";
    if (input.marketGapAnalysisId) {
      const [gap] = await this.read.select().from(marketGapAnalyses)
        .where(and(eq(marketGapAnalyses.id, input.marketGapAnalysisId), eq(marketGapAnalyses.ownerId, userId))).limit(1);
      if (!gap) throw new BadRequestException("That market-gap analysis could not be found.");
      const approved = (gap.opportunities as unknown as MarketGapOpportunity[]).filter((o) => (gap.decisions as Record<string, string>)[o.id] === "approved");
      if (approved.length) {
        gapText = `\n\nApproved market-gap opportunities to build on:\n${approved.map((o) => `- ${o.opportunity} (evidence: ${o.evidence})`).join("\n")}`;
      }
    }

    const competitorText = trackedCompetitors.map((c) => `${c.name} (${c.category})${c.rationale ? ` - ${c.rationale}` : ""}`).join("\n");

    if (!(await this.claude.enabledFor("competitive-intelligence"))) {
      throw new BadRequestException("AI is off right now, so competitive strategies can't be generated.");
    }

    const templateList = STRATEGY_TEMPLATES.map((t) => `${t.id}: ${t.label}`).join("\n");
    const fallback = () => ({ strategies: [] as CompetitiveStrategyItem[] });
    const { data, source } = await this.claude.json<{ strategies?: CompetitiveStrategyItem[] }>(
      `My business:\n${businessText}\n\nMy tracked competitors:\n${competitorText}${gapText}\n\n` +
      `Starting strategy templates (pick ONLY from these, by id - never invent a new one):\n${templateList}\n\n` +
      `Select 1-3 templates that genuinely fit the evidence above - never pick one just to fill a quota; a single well-grounded strategy beats three generic ones. ` +
      `For each: rationale (why this template fits, tied to the real evidence), positioning (one sentence), targetSegment, keyMessage (the core message, not full ad copy), differentiation (what makes this different from the competitors above), risk, and confidence ("low"|"medium"|"high"). ` +
      `Reply with JSON only: {"strategies": [{"id": "strat-1", "template": "<id from the list>", "label": "<matching label>", "rationale": "", "positioning": "", "targetSegment": "", "keyMessage": "", "differentiation": "", "risk": "", "confidence": "low"}]}.`,
      fallback, { userId, feature: "competitive-intelligence", effort: "medium", maxTokens: 1800 },
    );
    if (source !== "claude" || !data.strategies?.length) {
      throw new BadRequestException("Couldn't generate strategies right now - please try again shortly.");
    }

    const strategies = data.strategies.slice(0, 3).map((s, i) => ({
      ...s, id: s.id || `strat-${i + 1}`,
      confidence: (["low", "medium", "high"].includes(s.confidence) ? s.confidence : "low") as CompetitiveStrategyItem["confidence"],
    }));
    validateStrategies(strategies);

    const [row] = await this.db.insert(competitiveStrategies).values({
      id: newId(), ownerId: userId, businessId: input.businessId ?? null,
      competitorIds: trackedCompetitors.map((c) => c.id), marketGapAnalysisId: input.marketGapAnalysisId ?? null,
      strategies: strategies as never, source: "claude",
    }).returning();
    return row;
  }

  async get(userId: string, id: string) {
    const [row] = await this.read.select().from(competitiveStrategies).where(and(eq(competitiveStrategies.id, id), eq(competitiveStrategies.ownerId, userId))).limit(1);
    if (!row) throw new NotFoundException("That strategy generation could not be found.");
    return row;
  }

  async list(userId: string, businessId?: string) {
    const where = businessId ? and(eq(competitiveStrategies.ownerId, userId), eq(competitiveStrategies.businessId, businessId)) : eq(competitiveStrategies.ownerId, userId);
    const rows = await this.read.select().from(competitiveStrategies).where(where).orderBy(desc(competitiveStrategies.createdAt));
    return { items: rows };
  }

  async resolveStrategy(userId: string, id: string, strategyId: string, decision: "approved" | "rejected") {
    const row = await this.get(userId, id);
    const decisions = { ...(row.decisions ?? {}), [strategyId]: decision };
    const [updated] = await this.db.update(competitiveStrategies).set({ decisions: decisions as never }).where(eq(competitiveStrategies.id, id)).returning();
    return updated;
  }
}
