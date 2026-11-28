import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { audienceStrategies, businesses, competitors, customerSegments } from "../db/schema";
import { newId } from "../common/ids";
import { ClaudeService } from "../ai/claude.service";
import { validateSegments, type AudienceSegmentHypothesis } from "./audience-strategy";

const MAX_COMPETITORS = 5;
const MAX_SEGMENTS = 5;

type GenerateInput = { businessId: string; competitorIds?: string[] };

/**
 * Competitive Audience Strategy (Module 9): audience segment hypotheses
 * grounded in the business profile and any saved first-party CRM segments
 * (never a competitor's actual customer list - that data was never
 * available to begin with). Tracked competitors are optional context, not
 * a requirement - this module is about the member's own customers, not
 * competitor ad data. Never a rules fallback: a failed AI call refuses
 * rather than guessing a generic segment.
 */
@Injectable()
export class AudienceStrategyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
  ) {}

  async generate(userId: string, input: GenerateInput) {
    if (!input.businessId) throw new BadRequestException("A business profile is needed, so segments are grounded in your real positioning.");
    const [business] = await this.read.select().from(businesses).where(and(eq(businesses.id, input.businessId), eq(businesses.ownerId, userId))).limit(1);
    if (!business) throw new BadRequestException("That business profile could not be found.");

    const businessText = [
      `Business: ${business.name}`, `Industry: ${business.industryId}`,
      business.products && `Products/services: ${business.products}`,
      business.targetSegments && `Current target customers: ${business.targetSegments}`,
      business.geographicMarkets && `Markets: ${business.geographicMarkets}`,
      business.acquisitionGoals && `Acquisition goals: ${business.acquisitionGoals}`,
      business.existingChannels?.length && `Existing channels: ${business.existingChannels.join(", ")}`,
    ].filter(Boolean).join("\n");

    const segmentRows = await this.read.select().from(customerSegments).where(eq(customerSegments.ownerId, userId));
    const segmentText = segmentRows.length
      ? segmentRows.map((s) => `- "${s.name}" (saved CRM segment, source: ${s.source})`).join("\n")
      : "None saved yet.";

    const ids = [...new Set(input.competitorIds ?? [])].slice(0, MAX_COMPETITORS);
    let competitorText = "None tracked, or none selected.";
    if (ids.length) {
      const rows = await this.read.select().from(competitors).where(and(eq(competitors.ownerId, userId), inArray(competitors.id, ids), eq(competitors.status, "accepted")));
      if (rows.length) competitorText = rows.map((c) => `${c.name} (${c.category})`).join(", ");
    }

    if (!(await this.claude.enabledFor("competitive-intelligence"))) {
      throw new BadRequestException("AI is off right now, so audience hypotheses can't be generated.");
    }

    const fallback = () => ({ segments: [] as AudienceSegmentHypothesis[] });
    const { data, source } = await this.claude.json<{ segments?: AudienceSegmentHypothesis[] }>(
      `My business:\n${businessText}\n\nMy saved first-party CRM segments:\n${segmentText}\n\nTracked competitors (context only - never a source of their actual customers):\n${competitorText}\n\n` +
      `Find up to ${MAX_SEGMENTS} distinct audience segment hypotheses for MY business, grounded in product category, likely customer intent, the saved CRM segments above (if any), customer lifecycle stage, geography and channel fit. ` +
      `NEVER claim a competitor's customer list or private audience data is available - you don't have it and never will through this tool. NEVER state a numeric audience size (a headcount, a reach estimate) unless you are directly referencing one of the saved CRM segments by name above - otherwise describe the segment qualitatively and say the real size isn't known yet. ` +
      `For each segment give: name, whyValuable (why this segment could matter for this specific business), availableSignals (what real signal suggests this segment - e.g. a saved CRM segment, a product/channel fit, a geographic pattern), dataSource (exactly which of: "first-party CRM segment", "business profile", "public competitor positioning", "general category knowledge" - be honest, don't claim CRM if there isn't one), providerCompatibility (how this could actually be targeted - e.g. "Meta detailed targeting", "Google in-market audience", "a custom audience uploaded from your own CRM list", or "not directly targetable on an ad platform - needs manual outreach"), audienceEstimate (a sentence, never a bare number, unless citing a named saved segment), confidence ("low"|"medium"|"high"), restrictions (platform policy limits, data availability gaps, or legal/consent concerns), creativeRecommendation (one short creative angle for this segment), testPlan (a small, cheap way to validate this segment before committing real budget). ` +
      `Reply with JSON only: {"segments": [{"id": "aud-1", "name": "", "whyValuable": "", "availableSignals": "", "dataSource": "", "providerCompatibility": "", "audienceEstimate": "", "confidence": "low", "restrictions": "", "creativeRecommendation": "", "testPlan": ""}]}.`,
      fallback, { userId, feature: "competitive-intelligence", effort: "medium", maxTokens: 2000 },
    );
    if (source !== "claude" || !data.segments?.length) {
      throw new BadRequestException("Couldn't generate audience hypotheses right now - please try again shortly.");
    }

    const segments = data.segments.slice(0, MAX_SEGMENTS).map((s, i) => ({
      ...s, id: s.id || `aud-${i + 1}`,
      confidence: (["low", "medium", "high"].includes(s.confidence) ? s.confidence : "low") as AudienceSegmentHypothesis["confidence"],
    }));
    validateSegments(segments);

    const [row] = await this.db.insert(audienceStrategies).values({
      id: newId(), ownerId: userId, businessId: business.id, competitorIds: ids, segments: segments as never, source: "claude",
    }).returning();
    return row;
  }

  async get(userId: string, id: string) {
    const [row] = await this.read.select().from(audienceStrategies).where(and(eq(audienceStrategies.id, id), eq(audienceStrategies.ownerId, userId))).limit(1);
    if (!row) throw new NotFoundException("That audience-strategy batch could not be found.");
    return row;
  }

  async list(userId: string, businessId?: string) {
    const where = businessId ? and(eq(audienceStrategies.ownerId, userId), eq(audienceStrategies.businessId, businessId)) : eq(audienceStrategies.ownerId, userId);
    const rows = await this.read.select().from(audienceStrategies).where(where).orderBy(desc(audienceStrategies.createdAt));
    return { items: rows };
  }

  async resolveSegment(userId: string, id: string, segmentId: string, decision: "approved" | "rejected") {
    const row = await this.get(userId, id);
    const decisions = { ...(row.decisions ?? {}), [segmentId]: decision };
    const [updated] = await this.db.update(audienceStrategies).set({ decisions: decisions as never }).where(eq(audienceStrategies.id, id)).returning();
    return updated;
  }
}
